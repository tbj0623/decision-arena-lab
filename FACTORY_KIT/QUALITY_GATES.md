# QUALITY GATES — 什么叫"真的做完了"

## 三层门禁

### Gate A：能用

**通过条件**：一个没看过文档的人，能在 3 分钟内完成一次完整操作，并且结果正确。

必须验证的：

- [ ] 打开页面，没有控制台 error
- [ ] 主流程能走通（输入 → 计算 → 结果 → 保存/导出/清空）
- [ ] 计算结果**数值正确**（与独立重算对拍）
- [ ] 边界输入不崩溃（空值、极值、非法值）
- [ ] 测试**真的执行过**，而不是"文件存在"

**没过 Gate A，不做营销。**

### Gate B：不会误导

**通过条件**：一个理性的人看完输出，不会产生"这是预测/概率/专业建议"的误解。

必须验证的：

- [ ] 结果明确标注数据来源是**用户自己的主观输入**
- [ ] 没有任何概率、成功率、准确率、预测类的表述
- [ ] 数学表述准确（例如：临界点是"打平点"，不是"翻转点"，越过才翻转）
- [ ] 不确定的地方如实说"不知道"，不编造
- [ ] 高风险领域（医疗/法律/财务）有显眼警示
- [ ] 生成的"观点/视角"明确标注是规则模板，不是专业人士意见

**Gate B 是最容易被忽视、也最致命的一层。**
一个"能跑但会说谎"的产品，比"跑不起来的半成品"危害大得多。

### Gate C：能安全公开

**通过条件**：公开这个仓库和站点，不会造成隐私泄露、安全漏洞或版权问题。

必须验证的：

- [ ] 无密钥、无 `.env`、无凭据（**扫 git 全历史**，不只当前文件）
- [ ] 无未授权的第三方素材（图片/字体/音频/图标）
- [ ] 无 XSS（真的注入 payload 测过，不是只读代码）
- [ ] 无未经授权的网络请求（真的开 Network 面板看过）
- [ ] 许可证正确且与实际内容一致
- [ ] **公开的文件清单经过人工审视**（`git ls-files` 逐个看）
- [ ] 实际 URL 可访问（不是"推送成功"就行）

**没过 Gate C，不公开。不能为了赶截止时间跳过。**

---

## 什么叫"真的测试过"

### 反例（这些都不是测试）

```js
// ❌ 假测试：永远通过
test('算法正确', () => { assert.ok(true); });

// ❌ 假测试：只测不崩，不测对不对
test('能计算', () => { scoreDecision(input); });

// ❌ 假测试：断言了错误的东西
test('阈值存在', () => { assert.ok(result.thresholdShare !== undefined); });
//    没验证它代回去是否真的打平

// ❌ 假测试：写在文档里说"已测试"
// "本模块已通过单元测试" ← 没有任何命令输出支撑
```

### 正例

```js
// ✅ 数值断言：算出具体数字
test('t* 代回后两边打平', () => {
  const at = projectAtShare(input, 'f2', flip.thresholdShare);
  assert.ok(Math.abs(at.difference) < 1e-6, `实际差值 ${at.difference}`);
});

// ✅ 边界断言：真的造边界数据
test('全零权重必须抛错', () => {
  const zero = { ...input, factors: input.factors.map(f => ({ ...f, weight: 0 })) };
  assert.throws(() => scoreDecision(zero), (e) => e.code === 'ALL_ZERO_WEIGHTS');
});

// ✅ 反向断言：证明"不该发生的事"没发生
test('t* 两侧符号必须相反', () => {
  const lo = projectAtShare(input, 'f2', tStar - 0.02);
  const hi = projectAtShare(input, 'f2', tStar + 0.02);
  assert.ok(lo.difference > 0 && hi.difference < 0);
});

// ✅ 一致性断言：显示值必须能对上
test('贡献列相加等于合计', () => {
  const shown = round1SummingTo(deltas, difference);
  assert.equal(shown.reduce((a,b)=>a+b,0), Math.round(difference*10)/10);
});
```

---

## 变异测试：证明"测试本身是有效的"

**绿了的测试，不代表测试有效。** 一个测试可以被写得很宽松，以至于任何实现都能通过。

**变异测试的做法**：往被测代码里**故意注入 bug**，看测试会不会失败。

### 本项目的真实做法

对 8 个关键位置各注入一个 bug：

| # | 注入的 bug | 测试抓到了吗 |
|---|---|---|
| 1 | `magnitude` 乘以 1.01 | ❌ 最初**漏网** → 补了硬断言后 ✅ |
| 2 | `t*` 乘以 0.98 | ✅ |
| 3 | 删掉"两个选项同名"检查 | ✅ |
| 4 | 平局判断去掉 epsilon | ✅ |
| 5 | `projectAtShare` 不做权重重分配 | ✅ |
| 6 | 允许负权重 | ✅ |
| 7 | 评分不除以 total | ✅ |
| 8 | `direction` 的 increase/decrease 写反 | ✅ |

**结果：8/8 最终全部被抓到。**

**但最有价值的是第 1 条**：它最初**漏网**了，因为测试只间接断言了 `magnitude`，没有直接绑定它和 `difference`。
这正是变异测试的价值——它暴露的不是"代码错了"，而是"**测试的覆盖有洞**"。

### 怎么做（可直接复用）

```bash
# 1. 备份原文件
cp src/core.mjs src/core.mjs.bak

# 2. 注入一个变异（手工编辑，或用 sed）
sed -i 's/const magnitude = Math.abs(difference)/const magnitude = Math.abs(difference) * 1.01/' src/core.mjs

# 3. 跑测试，应当失败
node --test

# 4. 记录结果，恢复
cp src/core.mjs.bak src/core.mjs

# 5. 对每个关键位置重复
```

**判据**：**测试失败 = 这条变异被抓到（好）；测试通过 = 有覆盖洞（要补测试）。**

---

## 独立复核的价值

本次项目里，**同一批数值被三个人用不同方式算过**：

| 谁 | 怎么算的 | 发现了什么 |
|---|---|---|
| Lead | 直接调用 `core.mjs` 打印 | 负数 t\* 被标成 BOUNDARY |
| product-owner | 写独立脚本重算 5 条旅程的期望值 | 同上的 bug + 取整相加不等 |
| logic-engineer | 对照解析解逐条断言 | 一个测试断言的**前提**是错的 |

**没有一个问题是"写代码的人自己发现的"。**

这不是巧合，是分工的结果：
- 写代码的人**必然**会把自己设想的语义写进代码，然后按同样的设想写测试 → 盲区完全重合
- 独立复算的人**没有那个设想**，他们只是"从规格重新算一遍"，所以能撞出不一致

**所以：不能让写代码的人给自己打分。**
即使同一个人写代码和写测试，也要换一个"从规格出发"的视角重算一遍。

---

## 验收清单的写法

### 反例

```
- [ ] 界面美观
- [ ] 用户体验好
- [ ] 性能足够快
- [ ] 代码质量高
```

这些**无法验证**，写了等于没写。而且会让成员产生"已经验收过了"的错觉。

### 正例

```
- [ ] 360px 视口下 document.documentElement.scrollWidth <= clientWidth
     验证：browser_evaluate 返回 {scrollWidth: 360, clientWidth: 360}
- [ ] 6 因素 × 1000 次 scoreDecision + findFlipThresholds < 500ms
     验证：node --test → 实测 15.5ms
- [ ] 贡献列显示值相加 === 合计显示值
     验证：node --test 里的「取整一致性」用例，500 组随机数据 0 失配
- [ ] XSS payload 注入后 window.__XSS_FIRED === undefined
     验证：browser_evaluate 返回 {xssFired: false, injectedImg: 0}
```

**判据**：每一条都能回答"**我怎么知道它通过了？**"，答案是一个命令、一个返回值或一张截图。

---

## 发布门禁表（必须在报告里出现）

```
项目: ___        版本/commit: ___        北京时间: ___
Node算法测试: __/__ PASS   实际命令: ___
完整操作场景: __/5 PASS
移动端360px: PASS / FAIL / NOT_TESTED
键盘: PASS / FAIL / NOT_TESTED
隐私网络审计: PASS / FAIL / NOT_TESTED
敏感信息扫描: PASS / FAIL / NOT_TESTED
控制台错误数: ___
审查员意见: 阻止公开 / 可以公开 / 待授权
剩余P0严重缺陷: ___
证据文件: ___
```

**铁律：`NOT_TESTED` 不许写成 `PASS`。**
宁可交一份写着"这三项没测"的报告，也不要交一份全是 PASS 但经不起问的报告——
后者会在被问到第一个问题时崩掉，前者的可信度反而更高。
