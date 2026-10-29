# 部署说明 / Deployment

本项目是**纯静态站点**：没有任何构建步骤，没有后端，没有依赖。
`site/` 目录下的文件原样丢到任何静态托管上就能跑。

## 本地预览

```bash
node scripts/serve.mjs          # 默认 http://127.0.0.1:8080/
node scripts/serve.mjs 3000     # 指定端口
```

服务器只监听 `127.0.0.1`，不对外暴露，只用 Node 内置模块，不装任何东西。

> **必须走 HTTP(S)，不能双击打开。** 本站用原生 ES Module，`file://` 协议下浏览器会按 CORS
> 策略拒绝加载模块，页面白屏。这不是"部分浏览器"的差异，而是当前主流浏览器的统一行为，
> 因此本项目不为 `file://` 做兼容（那需要引入打包器，与"零依赖零构建"冲突）。
> 本地验证请用上面的 `scripts/serve.mjs`。

## GitHub Pages（推荐）

### 方式一：GitHub Actions（本仓库已配置）

仓库里已有 `.github/workflows/pages.yml`。推送后：

1. 进入仓库 **Settings → Pages**
2. **Build and deployment → Source** 选择 **GitHub Actions**
3. 推送到 `main` 分支，或在 Actions 页手动触发 `Deploy to GitHub Pages`
4. 等 workflow 变绿，站点地址是 `https://<owner>.github.io/<repo>/`

workflow 会**先跑测试**，测试不过就不会部署：

```yaml
- run: node --test tests/
- run: node scripts/check-no-network.mjs
```

需要的权限已经写在 workflow 里：

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

### 方式二：从分支部署

如果不想用 Actions：**Settings → Pages → Source** 选 `Deploy from a branch`，
分支选 `main`，目录选 `/ (root)`，然后把 `site/` 里的内容移到仓库根目录。

> 本项目把网站放在 `site/` 子目录，是为了让测试、脚本、文档和网站分开。
> 用方式一时 workflow 会上传 `site/` 作为 Pages 产物，`site/` 是相对于仓库的根。
> 如果改用分支部署，需要把 `site/*` 复制到根目录，或者用 `gh-pages` 分支。

### 相对路径（很重要）

所有资源都用相对路径（`./app.mjs`、`./styles/app.css`），
所以部署到 `https://<owner>.github.io/<repo>/` 这样的子路径下不会 404。
**如果你改成了绝对路径（以 `/` 开头），项目站点会挂。**

## 其他静态托管

| 平台 | 做法 |
|---|---|
| Cloudflare Pages | 构建命令留空，输出目录填 `site` |
| Netlify | Publish directory 填 `site`，Build command 留空 |
| Vercel | Framework 选 Other，Output Directory 填 `site` |
| 任意静态服务器 | 把 `site/` 的内容作为 web root |

以上都不需要付费，都在免费额度内。

## 部署后自检清单

推送成功 ≠ 线上可用。每次部署后请真的打开网址验证：

- [ ] 首页返回 200，标题显示「反悔雷达 · Decision Arena」
- [ ] 控制台**没有** 404（尤其是 `app.mjs` / `core.mjs` / `app.css`）
- [ ] 点「先看一个例子」→ 能载入示例
- [ ] 改一个权重滑杆 → 分数和结论会变
- [ ] 翻到「什么条件会翻转结论」→ 有阈值
- [ ] 手机宽度（360px）下没有横向滚动条
- [ ] 打开开发者工具 Network 面板 → 除了本站静态资源，**没有别的请求**

一条命令验证线上资源都能取到：

```bash
node -e "
const base='https://<owner>.github.io/<repo>/';
for (const p of ['','app.mjs','core.mjs','styles/app.css','features/narrative.mjs'])
  fetch(base+p).then(r=>console.log(r.status, p||'index.html'));
"
```

## 回滚

每个里程碑都是一个独立 commit。回滚到上一个可用版本：

```bash
git log --oneline            # 找到目标 commit
git revert <commit>          # 生成一个反向提交（推荐，保留历史）
# 或者
git reset --hard <commit> && git push --force-with-lease
```

## 备份

`scripts/make-release.mjs` 会生成 `dist/decision-arena-release.zip`，
只包含可发布的内容（`site/`、`tests/`、`scripts/`、`docs/`、`README.md`、`LICENSE`），
不含 `.git`、`work/`、`reports/`、任何日志或凭据。同时输出 SHA-256。
