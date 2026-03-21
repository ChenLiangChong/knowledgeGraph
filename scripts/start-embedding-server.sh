#!/bin/bash
# Start embedding server for the Knowledge Graph.
#
# Two backends supported:
#   1. Ollama (recommended) — auto-detected if installed
#   2. llama.cpp llama-server — fallback
#
# Ollama setup:
#   ollama pull qwen3-embedding:4b
#   ollama serve   # usually already running as a service
#
# llama.cpp setup:
#   1. Install llama-server: https://github.com/ggml-org/llama.cpp/releases
#   2. Download model:
#      huggingface-cli download Qwen/Qwen3-Embedding-4B-GGUF \
#        qwen3-embedding-4b-q4_k_m.gguf --local-dir ./models
#
# Environment variables (all optional):
#   KG_EMBEDDING_BACKEND     "ollama" or "llama-cpp" (default: auto-detect)
#   KG_EMBEDDING_MODEL_PATH  Path to .gguf file (llama-cpp only)
#   KG_EMBEDDING_HOST        Listen host (default: 127.0.0.1)
#   KG_EMBEDDING_PORT        Listen port (default: 11434 for ollama, 8080 for llama-cpp)
#   KG_EMBEDDING_GPU_LAYERS  GPU layers to offload, -1=all (llama-cpp only)

set -euo pipefail

BACKEND="${KG_EMBEDDING_BACKEND:-auto}"

# Auto-detect backend
if [ "$BACKEND" = "auto" ]; then
  if command -v ollama &>/dev/null; then
    BACKEND="ollama"
  elif command -v llama-server &>/dev/null; then
    BACKEND="llama-cpp"
  else
    echo "Error: Neither ollama nor llama-server found."
    echo ""
    echo "Install Ollama:     https://ollama.com/download"
    echo "Install llama.cpp:  https://github.com/ggml-org/llama.cpp/releases"
    exit 1
  fi
fi

if [ "$BACKEND" = "ollama" ]; then
  MODEL="${KG_EMBEDDING_OLLAMA_MODEL:-qwen3-embedding:4b}"

  # Check if model is pulled
  if ! ollama list 2>/dev/null | grep -q "$MODEL"; then
    echo "Pulling $MODEL..."
    ollama pull "$MODEL"
  fi

  echo "Ollama embedding ready."
  echo "  Model:    $MODEL"
  echo "  Endpoint: http://localhost:11434/v1/embeddings"
  echo ""
  echo "Ollama is typically already running as a service."
  echo "If not, run: ollama serve"

elif [ "$BACKEND" = "llama-cpp" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  MODELS_DIR="$SCRIPT_DIR/../models"

  if [ -n "${KG_EMBEDDING_MODEL_PATH:-}" ]; then
    MODEL_PATH="$KG_EMBEDDING_MODEL_PATH"
  else
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

  HOST="${KG_EMBEDDING_HOST:-127.0.0.1}"
  PORT="${KG_EMBEDDING_PORT:-8080}"
  GPU_LAYERS="${KG_EMBEDDING_GPU_LAYERS:--1}"

  echo "Starting llama.cpp embedding server..."
  echo "  Model:  $MODEL_PATH"
  echo "  Listen: $HOST:$PORT"

  exec llama-server \
    --model "$MODEL_PATH" \
    --host "$HOST" \
    --port "$PORT" \
    --embedding \
    --pooling last \
    --n-gpu-layers "$GPU_LAYERS" \
    --ctx-size 8192 \
    --log-disable
fi
