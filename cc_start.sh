#!/bin/bash

# 请替换为你的API令牌(这里获取 https://apis.kuai.host/register?aff=uU68 )：

# 注册有小额免费额度，可以免费使用


#=========================================


your_api_key=sk-123


#=========================================

# 注意，公共仓库中不要同步你的API令牌，否则可能会被滥用！
# 粘贴完成api key后，在下面终端窗口中输入 y 即可。















ANTHROPIC_BASE_URL=https://api.kuai.host


# 检查API令牌是否已修改
if [[ "$your_api_key" == *"输入你的API key 来启动claude"* ]]; then
    echo "❌ 错误：检测到您尚未修改API令牌！"
    echo ""
    echo "请按照以下步骤操作："
    echo "1. 访问 https://api.kuai.host/register?aff=z2C8 获取您的API令牌"
    echo "2. 将脚本中的 'your_api_key' 变量值替换为您的真实API令牌"
    echo ""
    exit 1
fi

echo "✅ API令牌检查通过，正在启动Claude Code..."
echo ""

unset CI

mkdir -p /workspace/project
cd /workspace/project

npm install -g @anthropic-ai/claude-code

export ANTHROPIC_AUTH_TOKEN=$your_api_key
export ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL

# 显示配置信息
echo "配置信息："
echo "- API令牌: ${your_api_key:0:10}...（已隐藏完整令牌）"
echo "- 基础URL: $ANTHROPIC_BASE_URL"
echo ""

claude