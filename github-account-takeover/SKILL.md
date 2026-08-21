---
name: github-account-takeover
description: 将部署在第三方/公司 Coze 账号环境内的 git 项目接管回开发者自己的 GitHub 账号（身份 + origin + 永久 PAT 凭据），使其可直接 pull/push 免密操作；当用户通过 GitHub 链接或 zip 把仓库部署到公司账号后需要同步回个人仓库、配置个人 git 操作权限时使用。
---

# Github Account Takeover（git 个人账号接管）

## 概述

用户用「公司/第三方 Coze 账号」通过 GitHub 仓库链接或 zip 部署了一个项目，随后又要在该环境里继续打磨、并把它同步回「开发者自己的 GitHub 仓库」。本 Skill 一键把当前环境的 git 接管回开发者个人账号：设置 commit 身份、把 origin 指向个人仓库、把永久 PAT 写入本机凭据库，之后 `git pull / push` 免输密码。

核心价值：只依赖系统自带 git，`bash` 即可运行，零额外依赖；接管逻辑与具体项目无关，可在任意 git 仓库复用。

## 何时使用

- 用户把个人 GitHub 仓库（public/private）部署到公司扣子账号后，想以**个人账号**操作并同步回自己的仓库。
- 用户要求「为我配置 git、让我用我的 GitHub 账号 push/pull、设置操作权限」。
- 用户提到需要 Personal Access Token（PAT）且希望「永久有效」。

不适用：仅在本地开发、无跨账号部署/同步诉求的场景。

## 工作方式

1. **判断触发**：确认诉求是「在当前 git 环境切回个人 GitHub 账号并同步」，而不是单次改某个文件。
2. **索要/确认 5 项配置**：用户姓名、GitHub 邮箱、GitHub 用户名、仓库名、PAT token。
   - 若用户未提供 PAT，指导其按 `scripts/config.example.sh` 头部注释生成「永久有效」的 classic token：Developer settings → Tokens (classic)，Expiration 选 `No expiration`，勾选 `repo`。
3. **生成配置**：把 `scripts/config.example.sh` 复制为 `config.sh` 并填入 5 项值（脚本依赖 `scripts/setup-git.sh` 同目录的 `config.sh`）。提示 PAT 属于机密，仅存在被 gitignore 的本地文件。
4. **执行接管**：运行 `bash scripts/setup-git.sh`，读取输出确认 `[OK]` 阶段。
5. **交付**：告知用户此后可直接 `git pull` / `git add` / `git commit` / `git push`；如 commit 作者仍显示旧账号，说明全局旧身份未清除，提示 `git config --global --unset user.name`（脚本只写仓库级身份，不污染全局）。

## 资源索引

- `scripts/setup-git.sh`：主执行脚本。任意 git 仓库内运行，顺序为「校验配置 → 设置身份 → 更新 origin → 内联 token 连接校验 → 写凭据」。**必须让用户在仓库根目录（目录下存在 `.git`）运行**。
- `scripts/config.example.sh`：配置模板 + 永久 PAT 申请步骤。**每次使用第一步就是拷它成 `config.sh` 并填写**。

## 注意事项

- **连接的校验必须放在写凭据之前，且用内联 token**（脚本已实现）。git 的 credential-store 在 token 被 GitHub 401 拒绝时会清空 `~/.git-credentials`，若先写凭据会被校验误清。
- **真实 `config.sh` 含 PAT，切勿入库或提交**。脚本本身不创建它；若在 Coze 环境中使用，确保该文件被 `.gitignore` 忽略。
- PAT 等同密码：凭证写入 `~/.git-credentials`（脚本已强制 0600 权限）；一旦怀疑泄露，应回 GitHub revoke。
- 脚本只写入**当前仓库级** `user.name/user.email` 与 `credential.helper store`，不覆盖用户全局配置。
- 若连接校验失败，脚本会 `exit 1` 且不写凭据——不要忽略该错误强推。