# ============================================================
# Git 个人账号配置模板
# 复制本文件为 config.sh 并填写你的信息（config.sh 已在 .gitignore 中，不会入库）
#   命令： cp scripts/git-sync/config.example.sh scripts/git-sync/config.sh
# ============================================================

# --- git 提交身份（写入 commit 作者 / 贡献者） ---
GIT_USER_NAME="你的姓名，例如 Zhang San"
GIT_USER_EMAIL="你的 GitHub 邮箱，例如 you@example.com"

# --- GitHub 个人账号（用于拼接仓库地址与凭据主机） ---
GITHUB_USERNAME="your-github-username"
GITHUB_REPO="your-repo-name"

# --- 永久有效的 PAT（Personal Access Token） ---
GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# ============================================================
# 怎么生成一个「永久有效」的 PAT（一次性，与账号无绑定限制）
#  1. 登录你的 GitHub → 右上角头像 → Settings
#  2. Developer settings → Personal access tokens → Tokens (classic)
#  3. Generate new token (classic)
#  4. Note：任意备注，建议写 lumen-coze-sync
#  5. Expiration：选 "No expiration"（永久有效）
#  6. 权限勾选：repo（可拉取并可推送代码，覆盖私有仓库）
#  7. Generate 后立即复制 ghp_xxx，填入上方 GITHUB_TOKEN
#     （该值只在生成时完整显示一次，请妥善保存）
#
# 安全提示：
#  - PAT 等同密码，切勿提交到任何公共仓库
#  - setup-git.sh 会把它写入 ~/.git-credentials，并以 0600 权限保存
#  - 一旦怀疑泄露，随时回 GitHub 上 Revoke 这个 token 即可作废
# ============================================================