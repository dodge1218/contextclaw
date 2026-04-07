#!/bin/bash
# NemoClaw 1-Click Setup — OpenClaw + ContextClaw + Free Models
# For DigitalOcean droplets (Ubuntu 22.04+), Raspberry Pi, or any $12/mo VPS
# Usage: curl -sSL https://raw.githubusercontent.com/dodge1218/contextclaw/master/scripts/nemoclaw-setup.sh | bash

set -e

echo "🧠 NemoClaw — Setting up your AI agent environment..."
echo "=================================================="

# System deps
echo "[1/6] Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl git build-essential

# Node.js (LTS)
echo "[2/6] Installing Node.js..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
echo "  Node $(node -v)"

# OpenClaw
echo "[3/6] Installing OpenClaw..."
if ! command -v openclaw &>/dev/null; then
  npm install -g openclaw
fi
echo "  OpenClaw $(openclaw --version 2>/dev/null || echo 'installed')"

# ContextClaw
echo "[4/6] Installing ContextClaw plugin..."
npm install -g contextclaw
echo "  ContextClaw installed (npm)"

# Configure free model providers
echo "[5/6] Configuring free model providers..."
cat > /tmp/nemoclaw-providers.json << 'EOF'
{
  "note": "NemoClaw default providers — all free tier",
  "providers": {
    "groq": {
      "name": "Groq (free, fast)",
      "signup": "https://console.groq.com",
      "models": ["llama-3.3-70b-versatile", "qwen-3-32b", "meta-llama/llama-4-scout-17b-16e-instruct"]
    },
    "cerebras": {
      "name": "Cerebras (free, fastest)",
      "signup": "https://cloud.cerebras.ai",
      "models": ["llama-3.3-70b"]
    },
    "openrouter": {
      "name": "OpenRouter (free tier)",
      "signup": "https://openrouter.ai",
      "models": ["deepseek/deepseek-r1:free", "meta-llama/llama-4-scout:free"]
    },
    "nvidia": {
      "name": "NVIDIA NIM (free 1000 req/day)",
      "signup": "https://build.nvidia.com",
      "models": ["nvidia/nemotron-3-super-120b-a12b", "deepseek-ai/deepseek-r1", "meta/llama-3.3-70b-instruct"]
    },
    "cohere": {
      "name": "Cohere (free for personal use)",
      "signup": "https://dashboard.cohere.com",
      "models": ["command-r-plus"]
    },
    "mistral": {
      "name": "Mistral (free tier)",
      "signup": "https://console.mistral.ai",
      "models": ["codestral-latest", "mistral-large-latest"]
    }
  }
}
EOF

echo "  Provider guide written to /tmp/nemoclaw-providers.json"
echo ""
echo "  To configure, get free API keys from:"
echo "    🟢 Groq:       https://console.groq.com"
echo "    🟢 Cerebras:   https://cloud.cerebras.ai"
echo "    🟢 OpenRouter:  https://openrouter.ai"
echo "    🟢 NVIDIA NIM: https://build.nvidia.com"
echo "    🟢 Cohere:     https://dashboard.cohere.com"
echo "    🟢 Mistral:    https://console.mistral.ai"
echo ""

# Lightpanda (optional browser)
echo "[6/6] Installing Lightpanda browser (optional)..."
if ! command -v lightpanda &>/dev/null; then
  curl -fsSL https://lightpanda.io/install.sh | bash 2>/dev/null || echo "  Lightpanda: skipped (install manually from lightpanda.io)"
fi

echo ""
echo "=================================================="
echo "🧠 NemoClaw setup complete!"
echo ""
echo "Next steps:"
echo "  1. Run: openclaw setup"
echo "  2. Add your free API keys when prompted"
echo "  3. Run: openclaw start"
echo "  4. Monitor context: npx contextclaw status"
echo ""
echo "Monthly cost breakdown:"
echo "  DigitalOcean droplet:  \$12/mo (2GB RAM)"
echo "  Groq API:             \$0 (free tier)"
echo "  Cerebras API:         \$0 (free tier)"
echo "  OpenRouter:           \$0 (free tier)"
echo "  NVIDIA NIM:           \$0 (1000 req/day free)"
echo "  ContextClaw:          \$0 (open source)"
echo "  ─────────────────────────────────"
echo "  TOTAL:                \$12/mo"
echo ""
echo "  vs. ChatGPT Pro: \$200/mo"
echo "  vs. Claude Max:  \$200/mo"
echo "  Savings:         94%"
echo ""
echo "📖 Guide: https://medium.com/@vonbrubeck/minmaxing-personal-ai"
echo "🧠 ContextClaw: https://github.com/dodge1218/contextclaw"
