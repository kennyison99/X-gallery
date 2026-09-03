#!/usr/bin/env bash
set -e
export VLLM_WSL2_ENABLE_PIN_MEMORY=1
export VLLM_USE_FLASHINFER_SAMPLER=0

exec /home/wtw0212/vllm-env/bin/vllm serve cyankiwi/Qwen3.5-4B-AWQ-4bit \
  --port 8000 \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.75 \
  --trust-remote-code
