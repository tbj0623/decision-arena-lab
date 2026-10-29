# 参与贡献 / Contributing

谢谢你对反悔雷达的关注。

这个项目的目标**不是**自动预测人们应该做什么，而是让「主观评分 + 敏感性分析」这件事尽可能**透明、可核对、不误导**。

---

## 先明确三条底线

在提任何 PR 之前，请确认它没有越过这三条。越过任何一条的改动会被直接拒绝，无论功能多好：

1. **不制造概率错觉。** 不得出现"成功率 / 胜率 / 准确率 / 预测置信度"等表述，也不得用视觉元素暗示存在客观概率。
2. **不引入任何外部请求。** 无 CDN、无字体外链、无分析 SDK、无后端 API、无 API key。`node scripts/check-no-network.mjs` 会检查这一点。
3. **不持久化用户输入。** 不使用 `localStorage` / `sessionStorage` / Cookie / IndexedDB。刷新即清空是产品的承诺，不是缺陷。

---

## 本地运行

需要 **Node.js 18+**。运行时**无任何 npm 第三方依赖**，不需要 `npm install`。

```bash
git clone https://github.com/tbj0623/decision-arena-lab.git
cd decision-arena-lab

node scripts/serve.mjs             # 本地预览 → http://127.0.0.1:8080
node --test                        # 全部测试
node scripts/check-no-network.mjs  # 核验零外部请求 / 零持久化
```

### 两个常见的坑

- **必须用静态服务器**，不能直接双击 `site/index.html`。本站用原生 ES Module，`file://` 下会被浏览器 CORS 策略拒绝，页面空白。
- **测试命令不要带目录参数**。Node 24 下 `node --test tests/` 会把目录当模块解析并报 `MODULE_NOT_FOUND`。请用无参数的 `node --test`，或 `node --test "tests/**/*.test.mjs"`。

---

## 目录结构

```
site/
  index.html            页面结构（含 noscript 兜底）
  app.mjs               DOM 渲染与事件绑定，不含数学
  core.mjs              ★ 全部数学：校验、评分、反转阈值、假设生成
  features/
    narrative.mjs       示例数据 + 三个视角的规则模板
    interval.mjs        ⚠️ 实验性区间分析，未接入 UI
  data/
    validation-actions.mjs  验证动作库
  styles/app.css

docs/
  product/              ★ 产品文档单一事实源（PRD / 验收清单 / 旅程 / 范围）
  PRIVACY.md            隐私说明
  LIMITATIONS.md        局限说明
  CHANGELOG.md          面向用户的版本变更
  assets/               README 封面、品牌图、原理图

tests/
  core/                 数学单元测试（scoreDecision / findFlipThresholds 等）
  qa/                   UI 契约、场景、审计脚本测试

scripts/
  serve.mjs             本地静态服务器（仅用 Node 内置 http）
  check-no-network.mjs  零外部请求 / 零持久化核验
  make-release.mjs      生成发行包
```

---

## 协作规则

### 算法改动

1. **所有数学必须集中在 `site/core.mjs`。** 不要在 `app.mjs` 或任何 DOM 层复制一套实现——两份数学实现是漂移的源头。
2. `core.mjs` 是**零依赖纯函数**，不得在其中引入 DOM、网络或全局状态，以保证它能在 Node 中被直接测试。
3. 任何算法改动**必须**附带覆盖边界条件的单元测试，至少包括：全零权重、4 与 6 个因素的上下限、评分越界、`t*` 落在 0–1 之外、完全打平。
4. 若改动触及**计算契约**（得分公式、平局判据 `1e-9`、反转阈值的定义），需在 PR 描述中显式说明，因为这会影响所有历史导出的可比性。

### 界面与文案

5. 面向用户的文字必须诚实：分数是**主观输入的加权结果**，不是"准确率""概率""预测"或专业建议。
6. 新增文案若涉及"会不会翻转"，必须同时给出限定语：**只调这一个因素、其余按原比例重分**。脱离前提的"会翻转"是误导。
7. 所有新设计需通过 **360 / 390 / 768 / 1440px** 四个宽度的检查：不得横向滚动，不得出现点不到的按钮。
8. 颜色不能是唯一的信息载体——状态需同时用文字或形状区分（例如"打平"不能只靠颜色差异表达）。

### 隐私与素材

9. 使用**虚构或去标识化**的示例。不要把真实用户的个人问题写进 Issue、测试文件或截图。
10. 视觉素材须注明来源，且应可离线使用、可审计。**不要提交来源不明的图片**，也不要把设计示意图当作真实产品截图。

---

## 提交前检查清单

- [ ] `node --test` 全部通过（不只看新增的测试）
- [ ] `node scripts/check-no-network.mjs` 通过
- [ ] 功能在**真实浏览器**里跑通过，不只是看了截图
- [ ] 改动 UI 时附上改动前后的**真实**截图（桌面 + 手机各一张更佳）
- [ ] 提交信息说明了：**影响范围、测试证据、潜在风险**
- [ ] 没有新增依赖、没有新增网络请求、没有新增存储

---

## 分支与提交

- 默认分支为 `main`。请在新分支上工作，通过 Pull Request 合并，不要直接推 `main`。
- 提交信息建议采用 `type(scope): 说明` 的形式，例如：
  - `fix(app): 6 个因素时占比列合计 100.2%`
  - `test(core): 补 t* 落在 0–1 之外的用例`
  - `docs(readme): 补充移动端截图`
- 一个 PR 尽量只做一件事。若同时改了算法和文案，请拆开——两者的评审标准不同。

---

## 报告安全或隐私问题

请**不要**在公开 Issue 中泄露 Token、凭据、真实个人信息或未打码的私人截图。

如发现安全问题或隐私缺陷，请优先使用仓库的**私密漏洞报告机制**（GitHub Security Advisories，若可用），或通过 Issue 先联系维护者、再协商私下提供细节。

---

## 许可

贡献即表示同意你的代码以 [MIT License](LICENSE) 发布。请注意本项目**不对任何现实决策的结果作保证**。
