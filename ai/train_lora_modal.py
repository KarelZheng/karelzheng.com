"""Train the Tiny Prague LoRA on an H100 with Modal, using ostris/ai-toolkit (the recipe tiny.london used).

NOT RUN HERE (no GPU, no Modal token in this session). Written against the ai-toolkit config format as of
mid-2026; before the first run, diff the generated YAML against ai-toolkit's own
config/examples/train_lora_qwen_image_edit*.yaml and fix any renamed keys.

Usage:
  modal volume create tinyprague-data
  modal volume put tinyprague-data ai/dataset /dataset        # controls/, targets/, captions (see README)
  modal secret create huggingface HF_TOKEN=hf_...
  modal run ai/train_lora_modal.py --steps 8000
Result: /output/<name>/<name>.safetensors on the volume (download with `modal volume get`).
"""
import modal

APP = modal.App("tinyprague-lora")
vol = modal.Volume.from_name("tinyprague-data", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .run_commands(
        "git clone --depth 1 https://github.com/ostris/ai-toolkit /ai-toolkit",
        "cd /ai-toolkit && pip install --no-cache-dir -r requirements.txt",
    )
)

# Two base-model options. Qwen-Image-Edit is Apache-2.0 and is what isometric.nyc's Modal inference server
# expects. Qwen-Image-2.1-Turbo (tiny.london) is faster at inference (8 steps, no CFG) but under the
# Qwen Research License (non-commercial).
BASES = {
    "edit": {"arch": "qwen_image_edit", "name_or_path": "Qwen/Qwen-Image-Edit"},
    "turbo": {"arch": "qwen_image_2", "name_or_path": "Qwen/Qwen-Image-2.1"},
}

def make_config(name: str, base: str, steps: int, lr: float, rank: int) -> str:
    b = BASES[base]
    return f"""
job: extension
config:
  name: {name}
  process:
    - type: sd_trainer
      training_folder: /output
      device: cuda:0
      trigger_word: null
      network:
        type: lora
        linear: {rank}
        linear_alpha: {rank}
      save:
        dtype: float16
        save_every: 1000
        max_step_saves_to_keep: 3
      datasets:
        - folder_path: /dataset/targets
          control_path: /dataset/controls
          caption_ext: txt
          caption_dropout_rate: 0.0
          cache_latents_to_disk: true
          resolution: [512, 1024]
      train:
        batch_size: 1
        steps: {steps}
        gradient_accumulation_steps: 1
        train_unet: true
        train_text_encoder: false
        gradient_checkpointing: true
        noise_scheduler: flowmatch
        timestep_type: shift
        optimizer: adamw8bit
        lr: {lr}
        dtype: bf16
        ema_config:
          use_ema: false
      model:
        name_or_path: {b['name_or_path']}
        arch: {b['arch']}
        quantize: true
        low_vram: false
      sample:
        sampler: flowmatch
        sample_every: 1000
        width: 1024
        height: 1024
        prompts:
          - "Fill in the outlined section with the missing pixels corresponding to the <isometric prague pixel art> style, removing the border and exactly following the shape/style/structure of the surrounding image (if present). --ctrl_img /dataset/controls/sample.png"
        neg: ""
        seed: 42
        guidance_scale: 1.0
        sample_steps: 20
"""

@APP.function(image=image, gpu="H100", timeout=8 * 3600, volumes={"/dataset": vol, "/output": vol}, secrets=[modal.Secret.from_name("huggingface")])
def train(name: str = "tiny-prague-v1", base: str = "edit", steps: int = 8000, lr: float = 1e-4, rank: int = 32):
    import os, subprocess
    cfg = make_config(name, base, steps, lr, rank)
    os.makedirs("/output", exist_ok=True)
    path = f"/output/{name}.yaml"
    open(path, "w").write(cfg)
    print(cfg)
    subprocess.run(["python", "run.py", path], cwd="/ai-toolkit", check=True)
    vol.commit()
    return f"/output/{name}"

@APP.local_entrypoint()
def main(name: str = "tiny-prague-v1", base: str = "edit", steps: int = 8000, lr: float = 1e-4, rank: int = 32):
    print(train.remote(name=name, base=base, steps=steps, lr=lr, rank=rank))
