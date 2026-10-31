"""DRAFT: joint sampling of the whole Prague canvas with a Qwen-Image LoRA (the tiny.london method).

Idea (from tiny.london/how, which itself cites MultiDiffusion, arXiv 2302.08113, and RePaint):
  * One latent tensor covers a whole block of the map. Each denoising step runs the model on overlapping
    1024 px windows (stride 768, odd steps shifted by 384) and averages the per-window predictions into the
    shared latent, weighted by a tent that is 0 at the window edge and flat across the middle 512 px.
    So there are no tile boundaries during sampling, hence no seams.
  * Already-finished pixels (the margin of neighbouring blocks) are pinned at every step (RePaint): after each
    step, the latent of known regions is replaced by the forward-noised known latent at that timestep.
  * Blocks of 12288 px are run in four parity phases so blocks in one phase never touch.

STATUS: untested, written without a GPU. The window/weight/pinning logic is complete; the three calls into
diffusers that need checking against the installed version are marked CHECK. Expect one debugging session on
an H100 before it runs. Fallback that needs no new code: isometric-nyc's generation app with its infill rules.
"""
import math
import numpy as np
import torch
from PIL import Image

WINDOW = 1024
STRIDE = 768
STEPS = 8
VAE_SCALE = 8            # pixels per latent cell
LW = WINDOW // VAE_SCALE  # 128 latent cells


def tent_weight(n=LW, flat=64):
    """1-D tent: 0 at edges, 1 across the middle `flat` cells."""
    w = np.ones(n, np.float32)
    ramp = (n - flat) // 2
    for i in range(ramp):
        w[i] = (i + 0.5) / ramp
        w[n - 1 - i] = (i + 0.5) / ramp
    return torch.from_numpy(np.outer(w, w))


def windows(H, W, step_idx):
    """Window origins (latent cells) for a canvas H x W; odd steps shifted by half a stride."""
    off = (STRIDE // 2 // VAE_SCALE) if step_idx % 2 else 0
    s = STRIDE // VAE_SCALE
    ys = list(range(-off, H - LW + 1 + s, s)); xs = list(range(-off, W - LW + 1 + s, s))
    out = []
    for y in ys:
        for x in xs:
            y0 = max(0, min(y, H - LW)); x0 = max(0, min(x, W - LW))
            if (y0, x0) not in out:
                out.append((y0, x0))
    return out


@torch.no_grad()
def sample_block(pipe, control_rgb, known_rgb, known_mask, prompt, seed=0, device="cuda"):
    """
    pipe        : diffusers QwenImageEditPipeline (or the 2.1 pipeline) with the Prague LoRA loaded.
    control_rgb : uint8 HxWx3, the orthographic 3D-tiles render for the whole block (multiple of 8).
    known_rgb   : uint8 HxWx3, finished pixel art where known (the margin from neighbouring blocks), else 0.
    known_mask  : bool HxW, True where known_rgb is final.
    Returns uint8 HxWx3.
    """
    g = torch.Generator(device).manual_seed(seed)
    vae, transformer, sched = pipe.vae, pipe.transformer, pipe.scheduler
    H, W = control_rgb.shape[0] // VAE_SCALE, control_rgb.shape[1] // VAE_SCALE

    def encode(img):  # CHECK: diffusers' exact VAE call / scaling for Qwen-Image (latents_mean/std)
        t = torch.from_numpy(img).permute(2, 0, 1).float().div(127.5).sub(1).unsqueeze(0).to(device, torch.bfloat16)
        z = vae.encode(t).latent_dist.mode()
        return (z - pipe.latents_mean) / pipe.latents_std if hasattr(pipe, "latents_mean") else z * vae.config.scaling_factor

    def decode(z):  # CHECK: inverse of encode
        z = z * pipe.latents_std + pipe.latents_mean if hasattr(pipe, "latents_mean") else z / vae.config.scaling_factor
        x = vae.decode(z).sample
        return ((x.clamp(-1, 1) + 1) * 127.5).round().byte()[0].permute(1, 2, 0).cpu().numpy()

    ctrl_lat = encode(control_rgb)                      # 1 x C x H x W
    known_lat = encode(known_rgb)
    kmask = torch.from_numpy(known_mask[::VAE_SCALE, ::VAE_SCALE]).to(device)[None, None].float()
    prompt_embeds = pipe.encode_prompt(prompt, device=device)   # CHECK: signature; cache per prompt

    sched.set_timesteps(STEPS, device=device)
    ts = sched.timesteps
    x = torch.randn(ctrl_lat.shape, generator=g, device=device, dtype=torch.bfloat16)
    wt = tent_weight().to(device, torch.bfloat16)
    for i, t in enumerate(ts):
        # RePaint pinning: replace known cells with the known latent noised to this timestep
        sigma = sched.sigmas[i] if hasattr(sched, "sigmas") else t / 1000.0
        noise = torch.randn(ctrl_lat.shape, generator=g, device=device, dtype=x.dtype)
        x = x * (1 - kmask) + ((1 - sigma) * known_lat + sigma * noise) * kmask
        # MultiDiffusion: average per-window predictions
        acc = torch.zeros_like(x); wsum = torch.zeros_like(x[:, :1])
        for (y0, x0) in windows(H, W, i):
            xin = x[:, :, y0:y0 + LW, x0:x0 + LW]; cin = ctrl_lat[:, :, y0:y0 + LW, x0:x0 + LW]
            # CHECK: how the edit pipeline feeds the control latent (concat along sequence for Qwen-Image-Edit)
            v = transformer(hidden_states=xin, timestep=t.expand(1), encoder_hidden_states=prompt_embeds, control_latents=cin).sample
            acc[:, :, y0:y0 + LW, x0:x0 + LW] += v * wt
            wsum[:, :, y0:y0 + LW, x0:x0 + LW] += wt
        v_mean = acc / wsum.clamp_min(1e-4)
        x = sched.step(v_mean, t, x).prev_sample
    x = x * (1 - kmask) + known_lat * kmask
    return decode(x)


def run_blocks(pipe, render_canvas, out_canvas, done_mask, prompt, block=12288, margin=1024):
    """Four parity phases over a big canvas; each block reads a `margin` of finished neighbours."""
    Hc, Wc = render_canvas.shape[:2]
    for phase in range(4):
        py, px = phase // 2, phase % 2
        for by in range(py * block, Hc, 2 * block):
            for bx in range(px * block, Wc, 2 * block):
                y0, x0 = max(0, by - margin), max(0, bx - margin); y1, x1 = min(Hc, by + block + margin), min(Wc, bx + block + margin)
                ctrl = render_canvas[y0:y1, x0:x1]; known = out_canvas[y0:y1, x0:x1]; km = done_mask[y0:y1, x0:x1]
                res = sample_block(pipe, ctrl, known, km, prompt, seed=by * 7919 + bx)
                iy0, ix0 = by - y0, bx - x0
                out_canvas[by:by + block, bx:bx + block] = res[iy0:iy0 + block, ix0:ix0 + block]
                done_mask[by:by + block, bx:bx + block] = True
    return out_canvas
