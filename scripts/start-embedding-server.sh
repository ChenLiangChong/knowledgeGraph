#!/bin/bash
# Start embedding server using llama.cpp
#
# Prerequisites:
#   1. llama-server installed (compile from source or download release)
#      https://github.com/ggml-org/llama.cpp/releases
#   2. Download a GGUF embedding model:
#      huggingface-cli download Qwen/Qwen3-Embedding-4B-GGUF \
#        qwen3-embedding-4b-q4_k_m.gguf --local-dir ./models
#
# Environment variables (all optional):
#   KG_EMBEDDING_MODEL_PATH  Path to .gguf file (default: ./models/*.gguf)
#   KG_EMBEDDING_HOST        Listen host (default: 127.0.0.1)
#   KG_EMBEDDING_PORT        Listen port (default: 8080)
#   KG_EMBEDDING_GPU_LAYERS  GPU layers to offload, -1=all (default: -1)
#   KG_EMBEDDING_CTX_SIZE    Context size in tokens (default: 8192)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODELS_DIR="$SCRIPT_DIR/../models"

# Find model file
if [ -n "${KG_EMBEDDING_MODEL_PATH:-}" ]; then
  MODEL_PATH="$KG_EMBEDDING_MODEL_PATH"
else
  # Auto-detect first .gguf file in models/
  MODEL_PATH=$(find "$MODELS_DIR" -maxdepth 1 -name "*.gguf" -print -quit 2>/dev/null || true)
fi

if [ -z "$MODEL_PATH" ] || [ ! -f "$MODEL_PATH" ]; then
  echo "Error: No GGUF model found."
  echo ""
  echo "Download one with:"
  echo "  huggingface-cli download Qwen/Qwen3-Embedding-4B-GGUF \\"
  echo "    qwen3-embedding-4b-q4_k_m.gguf --local-dir $MODELS_DIR"
  exit 1
fi

# Check llama-server
if ! command -v llama-server &>/dev/null; then
  echo "Error: llama-server not found in PATH"
  echo ""
  echo "Install from: https://github.com/ggml-org/llama.cpp/releases"
  exit 1
fi

HOST="${KG_EMBEDDING_HOST:-127.0.0.1}"
PORT="${KG_EMBEDDING_PORT:-8080}"
GPU_LAYERS="${KG_EMBEDDING_GPU_LAYERS:--1}"
CTX_SIZE="${KG_EMBEDDING_CTX_SIZE:-8192}"

echo "Starting embedding server..."
echo "  Model:      $MODEL_PATH"
echo "  Listen:     $HOST:$PORT"
echo "  GPU layers: $GPU_LAYERS"
echo "  Context:    $CTX_SIZE"

exec llama-server \
  --model "$MODEL_PATH" \
  --host "$HOST" \
  --port "$PORT" \
  --embedding \
  --pooling last \
  --n-gpu-layers "$GPU_LAYERS" \
  --ctx-size "$CTX_SIZE" \
  --log-disable
