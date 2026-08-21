---
name: github-account-takeover
description: 为当前 git 仓库配置或切换为开发者个人 GitHub 账号：设置提交身份、更新远程 origin、写入永久 Personal Access Token(PAT) 凭据，实现免密 git pull/push 并同步回个人仓库；当用户需要配置或切换 git 账号、设置 GitHub 凭证或 token、把代码推送或同步到自己 GitHub 仓库、或将部署在公司/第三方账号环境里的项目用个人账号接管时使用。
---

# github-account-takeover（git 个人账号接管）

## 概述

一键把「当前 git 环境」切换回开发者的个人 GitHub 账号，解决「用公司/第三方账号部署 + 同步回个人仓库」的双向需求：设置 commit 身份 → 更新 origin 指向个人仓库 → 写入永久 PAT 凭据，之后 `git pull / push` 免密码。

只依赖系统自带 git，`bash` 即可运行；接管逻辑与具体项目无关，任意 git 仓库可复用。

## 何时使用（触发场景）

以下任一用户表达或诉求出现时，应使用本 Skill：

- 「帮我配置 git，让我用**我的** GitHub 账号 push / pull」
- 「把这个项目同步 / 推送回我的 GitHub 仓库」
- 「配置 GitHub token / PAT，免密提交 / 免密 push」
- 「设置 git 用户名邮箱 / 提交身份 / 远程地址 origin」
- 「把部署在公司账号上的项目，用我个人账号接管 / 切回自己的仓库」

**前提**：
- 当前目录是 git 仓库（存在 `.git`，或脚本能定位到仓库根）
- 用户持有目标 GitHub 仓库写权限，且有一个 PAT

**不适用**：单次改动某个文件、纯本地开发无跨账号同步诉求、当前目录不是 git 仓库。

## 操作步骤

1. **确认 5 项配置**：`GIT_USER_NAME`、`GIT_USER_EMAIL`、`GITHUB_USERNAME`、`GITHUB_REPO`、`GITHUB_TOKEN`。缺少的向用户逐一索要。
2. **补齐 PAT**：若用户未提供，指导其按 `scripts/config.example.sh` 头部注释生成「永久有效」classic token（Developer settings → Tokens (classic) → Expiration 选 `No expiration` → 勾选 `repo`）。
3. **生成 config.sh**：把 `scripts/config.example.sh` 复制到**用户项目目录下**（建议项目根或临时目录，不要写进 skill 目录），命名 `config.sh` 并填入 5 项值。提醒 PAT 是机密，勿提交。
4. **执行脚本**：`bash <skill 路径>/scripts/setup-git.sh /path/to/config.sh`。省略路径参数时默认读脚本同目录的 `config.sh`。逐条确认输出中的 `[OK]`。
5. **交付**：告知用户此后可直接 `git pull` / `git add` / `git commit` / `git push`。若 commit 作者仍显旧账号，提示 `git config --global --unset user.name`（脚本只写仓库级身份，不动全局）。

## 资源索引

- `scripts/setup-git.sh`：主执行脚本。可接受一个可选位置参数 `config.sh 路径`；内部顺序为「校验配置 → 设置身份 → 更新 origin → 内联 token 连接校验 → 写凭据」。**需在 git 仓库内运行**。
- `scripts/config.example.sh`：配置模板 + 永久 PAT 申请步骤。每次使用第一步就是拷它生成 `config.sh`。

## 注意事项

- **连接校验先于写凭据、且用内联 token**（脚本已实现）：git 的 credential-store 在 token 被 GitHub 401 拒绝时会清空 `~/.git-credentials`，先写凭据会被校验误清。
- **config.sh 含 PAT，严禁入库**：把它放在用户项目目录并确保被 `.gitignore` 忽略，不要写进 skill 目录随包分发。
- 凭据写入 `~/.git-credentials`（脚本强制 0600 权限）；一旦怀疑泄露，立即回 GitHub revoke。
- 脚本只写**当前仓库级** `user.name / user.email / credential.helper store`，不覆盖用户全局配置。
- 连接校验失败会 `exit 1` 且不写凭据——不要忽略该错误强行推。