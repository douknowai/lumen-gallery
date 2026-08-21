#!/usr/bin/env bash
# ============================================================
# setup-git.sh — 把你的个人 GitHub 账号「接管」当前扣子开发环境
#
# 适用场景：
#   你用公司扣子账号，通过 Git pull / zip 把个人 GitHub 仓库部署上来，
#   打磨后又想同步回自己的仓库。每次部署后跑一次本脚本，即可让当前
#   环境的 git 全部切回「你自己的账号」，之后直接 pull / push 免输密码。
#
# 用法：
#   1. 复制 config.example.sh 为 config.sh 并填写个人账号信息与 PAT
#   2. bash scripts/git-sync/setup-git.sh
#   3. 完成后即可 git pull / git add / git commit / git push
#
# 说明：连接校验放在写入凭据【之前】，用内联 token 完成，
#       避免 git 的 credential-store 在 token 被拒时误清空凭据库。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 配置路径优先级：命令行参数 > 环境变量 SETUP_GIT_CONFIG > 脚本同目录 config.sh
CONFIG_FILE="${1:-${SETUP_GIT_CONFIG:-${SCRIPT_DIR}/config.sh}}"

# ---------- 0. 读取配置 ----------
if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "[ERROR] 未找到配置 ${CONFIG_FILE}" >&2
  echo "        请先执行： cp ${SCRIPT_DIR}/config.example.sh ${CONFIG_FILE}" >&2
  echo "        然后在 ${CONFIG_FILE} 里填入你的 GitHub 账号与永久 PAT。" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${CONFIG_FILE}"

# ---------- 1. 参数校验（必填项） ----------
missing=0
for var in GIT_USER_NAME GIT_USER_EMAIL GITHUB_USERNAME GITHUB_REPO GITHUB_TOKEN; do
  if [[ -z "${!var:-}" ]]; then
    echo "[ERROR] 配置缺失：${var}（请到 ${CONFIG_FILE} 补齐）" >&2
    missing=1
  fi
done
if [[ "${missing}" -eq 1 ]]; then
  exit 1
fi

case "${GITHUB_TOKEN}" in
  *"你的姓名"*|ghp_xxxxx*|*ghp_xxxxxxxx*)
    echo "[ERROR] 检测到 config.sh 仍在使用模板占位值，请填入你的真实信息。" >&2
    exit 1
    ;;
esac

# ---------- 2. 定位仓库根目录 ----------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "${REPO_ROOT}" ]]; then
  cd "${REPO_ROOT}"
fi

echo "==> 接管环境：${GITHUB_USERNAME} / ${GITHUB_REPO}"
echo "    仓库目录：${REPO_ROOT:-$(pwd)}"

# ---------- 3. 设置 git 身份（写入当前仓库本地配置，不污染全局） ----------
git config user.name  "${GIT_USER_NAME}"
git config user.email "${GIT_USER_EMAIL}"
echo "[OK] git 身份 → ${GIT_USER_NAME} <${GIT_USER_EMAIL}>"

# ---------- 4. 配置远程 origin（干净的 URL，不内嵌 token） ----------
REMOTE_URL="https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}.git"
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "${REMOTE_URL}"
  echo "[OK] 已新增 origin → ${REMOTE_URL}"
else
  git remote set-url origin "${REMOTE_URL}"
  echo "[OK] 已更新 origin → ${REMOTE_URL}"
fi

# ---------- 5. 连接校验（内联 token，先于写凭据，避免误清空凭据库） ----------
echo '==> 正在校验与 GitHub 的连接与读写权限...'
AUTH_URL="https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${GITHUB_REPO}.git"
if git ls-remote "${AUTH_URL}" >/dev/null 2>&1; then
  echo "[OK] 连接成功，你的账号可正常访问该仓库"
else
  echo "[ERROR] 连接校验失败！不会写入凭据。请检查：" >&2
  echo "       1) token 是否有效且为“永久有效”（No expiration）" >&2
  echo "       2) 是否勾选 repo 权限（含私有仓库）" >&2
  echo "       3) GITHUB_USERNAME / GITHUB_REPO 是否与你个人仓库一致" >&2
  exit 1
fi

# ---------- 6. 写入永久 PAT 到 git 凭据库（免密 push/pull） ----------
# 启用 credential store 并追加凭据主机；若已存在相同主机则去重，避免堆积脏数据
git config credential.helper store
CRED_LINE="https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com"
CRED_FILE="${HOME:-$HOME}/.git-credentials"
mkdir -p "$(dirname "${CRED_FILE}")"
touch "${CRED_FILE}"
# 去掉旧的该用户名@github.com 条目，再追加新的
grep -v "https://${GITHUB_USERNAME}:[^@]*@github.com" "${CRED_FILE}" > "${CRED_FILE}.tmp" || true
mv "${CRED_FILE}.tmp" "${CRED_FILE}"
printf '%s\n' "${CRED_LINE}" >> "${CRED_FILE}"
chmod 600 "${CRED_FILE}"
echo "[OK] 永久 PAT 已写入凭据库 ${CRED_FILE}（权限 600，仅当前用户可读）"

echo ""
echo "=========================================="
echo "完成！当前环境 git 已接管为你个人账号"
echo "现在可直接使用："
echo "   git pull"
echo "   git add . && git commit -m 'message' && git push"
echo ""
echo "若 commit 作者仍显示为公司账号："
echo "   可先清除全局旧身份： git config --global --unset user.name"
echo "   （本脚本只写入当前仓库级身份，不覆盖你的全局配置）"
echo "=========================================="