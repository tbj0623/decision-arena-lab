# LAUNCH CHECKLIST — 从"本地能跑"到"公网已验证"

> 核心原则：**发布不是一个动作，是五个状态。**
> 每个状态必须用一个**真实的观测结果**推进，不能靠上一步的成功来推断。

```
LOCAL_BUILT → TEST_PASSED → REPO_PUSHED → SITE_DEPLOYED → SITE_VERIFIED
```

宣传另记：`CONTENT_READY → CONTENT_POSTED → POST_VERIFIED`

---

## 0. 发布前（不要跳过）

### 0.1 测试全绿

```bash
node --test                          # 必须 0 fail
node scripts/check-no-network.mjs    # 必须 exit 0
```

**证据**：命令 + 真实通过数。**"我跑过了"不算证据。**

### 0.2 敏感信息扫描（**扫历史，不只扫当前文件**）

```bash
git log -p --all | grep -Ei "sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN.*PRIVATE KEY"
```

⚠️ **注意误报**：审计脚本自身的正则字面量会命中（例如 `check-no-network.mjs` 里那行定义
"私钥模式"的代码）。要**人工看每一条命中**，判断是"规则定义"还是"真密钥"。

**为什么要扫历史**：即使当前文件干净，一旦某次提交里出现过密钥，它就永远在历史里。
`git rm` 只是删了当前版本，历史仍在。

### 0.3 公开文件清单人工审视

```bash
git ls-files
```

**逐个看**。问自己：
- 这个文件里有没有内部过程稿、原始日志、临时脚本？
- 这个文件里有没有真实的个人信息（人名、邮箱、客户名）？
- 这个文件是"成果"还是"过程"？

**不要把过程稿当成果公开。** 过程稿的正确去处是内部目录（并被 `.gitignore` 排除）。

### 0.4 `.gitignore` 检查

```bash
git status --ignored --short | head -30
```

确认应该排除的东西真的被排除了。

⚠️ **`.gitignore` 对已被跟踪的文件无效**。如果某文件已经 `git add` 过，加规则不会移除它，
必须 `git rm --cached`。

---

## 1. 仓库

### 1.1 名称查重

```bash
gh api repos/<owner>/<repo-name>   # 期望 404
```

**不要猜 owner**，用 `gh api user --jq '.login'` 拿真实的。

### 1.2 创建（只建新仓库）

```bash
gh repo create <repo-name> \
  --public \
  --description "..." \
  --source . \
  --remote origin \
  --push
```

**红线**：
- 只创建**本项目的新仓库**
- **绝不**触碰 owner 名下的其他仓库
- 不修改、不删除、不公开任何已有仓库

### 1.3 确认 remote 正确

```bash
git remote -v
```

**证据**：输出里必须是 `https://github.com/<owner>/<repo>.git`。

---

## 2. CI / Pages

### 2.1 Workflow 文件必须有正确权限

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

缺 `pages: write` → 部署被拒。缺 `id-token: write` → OIDC 换不到部署令牌。

### 2.2 测试必须在部署之前

```yaml
deploy:
  needs: [test, build]     # ← 这一行是关键
```

没有 `needs`，测试挂了也会部署。

### 2.3 Pages Source 设为 GitHub Actions

```bash
gh api --method POST /repos/<owner>/<repo>/pages -f build_type=workflow
```

| 返回 | 含义 | 下一步 |
|---|---|---|
| 201 / 204 | 成功 | 继续 |
| 409 | 已存在 | 用 `--method PUT` 更新 |
| 403 / 404 | 权限不足 | **记 NEEDS_AUTH，不要重试超过 2 次** |

**不要假设 `repo` scope 就能设 Pages。** 本项目的 `gh` 有 `repo` scope，
但 Pages 设置仍可能需要仓库管理员级别的额外确认。

### 2.4 等待 workflow

```bash
gh run list --limit 5
gh run view <run-id> --log-failed   # 失败时看日志
```

**铁律**：CI 绿 ≠ 公网可访问。继续下一步。

---

## 3. 真实验证（最容易偷懒的一步）

### 3.1 首页 200

```bash
Invoke-WebRequest -Uri "https://<owner>.github.io/<repo>/" -UseBasicParsing
# 或
node -e "fetch('https://<owner>.github.io/<repo>/').then(r=>console.log(r.status))"
```

**必须看到 200**，并且内容包含产品标题（证明不是占位页 / 404 页）。

### 3.2 子路径资源（经典 404 坑）

项目站点部署在 `/<repo>/` 子路径下。**任何以 `/` 开头的资源路径都会 404。**

```bash
for p in "" app.mjs core.mjs styles/app.css features/narrative.mjs; do
  echo -n "$p -> "
  curl -s -o /dev/null -w "%{http_code}\n" "https://<owner>.github.io/<repo>/$p"
done
```

**全部必须 200。**

**根因**：`<script src="/app.mjs">` 会解析成 `https://<owner>.github.io/app.mjs`（少了 `/<repo>/`）。
正确写法是 `"./app.mjs"`。

### 3.3 浏览器真渲染

用浏览器工具打开 URL，检查：

- [ ] 页面标题正确
- [ ] **控制台 0 个 error**（尤其是 404）
- [ ] 交互可用（点按钮有反应）
- [ ] 计算结果的数字和本地一致

**为什么必须用浏览器**：HTTP 200 只能证明"文件能取到"，不能证明"页面能跑"。
一个 JS 语法错误会让所有资源都 200 但页面全白。

---

## 4. 隐私与安全（公开的硬门槛）

- [ ] 无密钥（扫过历史）
- [ ] 无第三方素材（字体/图片/图标库）
- [ ] 真开 Network 面板点遍所有按钮 → 无第三方请求
- [ ] XSS payload 真注入过 → 无执行
- [ ] 许可证正确（且与实际内容一致）
- [ ] 站点页面有隐私说明和局限说明的入口

---

## 5. 回滚方案（发布前就要想好）

```bash
git log --oneline                 # 找上一个可用 commit
git revert <commit>               # 生成反向提交（推荐，保留历史）
git push
```

**必须知道**：回滚 CI 配置和回滚代码是两件事。如果 workflow 本身坏了，代码 revert 也救不回来。

---

## 6. 发布状态矩阵（写进报告）

| 项目 | 状态 | 证据 |
|---|---|---|
| 本地 index.html 可运行 | PASS / FAIL | 命令与输出 |
| 算法单测 | PASS / FAIL | 通过数 |
| 新 GitHub 仓库建立 | PASS / NEEDS_AUTH / FAIL | 真实 repo URL |
| 仓库文件无敏感信息 | PASS / FAIL | 检查方式 |
| GitHub Pages 来源设置 | PASS / NEEDS_AUTH / FAIL | 设置说明 |
| Workflow 部署 | PASS / FAIL | 真实 run 链接 |
| **公网网页打开** | **PASS / FAIL** | **已验证 URL 和时间** |
| 手机 360px 可操作 | PASS / FAIL / NOT_TESTED | 证据 |
| 开源 License/README/隐私说明 | PASS / FAIL | 真实路径 |
| 社交发布 | NOT_REQUESTED / DRAFT_READY / PUBLISHED | 平台 + URL |

### 三条不许犯的错

1. **不许把 `NOT_TESTED` 写成 `PASS`**
2. **不许把"CI 绿"写成"已上线"**
3. **不许把"推送成功"写成"已验证"**

---

## 7. 时间保护

| 情况 | 动作 |
|---|---|
| 部署失败 1 次 | 读日志，修一次 |
| 部署失败 2 次 | **停止排错**，保存日志，写一屏"需用户授权的最少步骤" |
| 离截止 < 1 小时 | 放弃新的部署尝试，保住本地发行 ZIP |

**为什么**：一个"Settings 里点两下"的开关，不值得吃掉最后一小时。
本地完整的发行包 + 一句清晰的待办说明，比一个半死不活的部署有价值得多。
