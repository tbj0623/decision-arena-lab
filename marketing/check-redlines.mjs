#!/usr/bin/env node
/**
 * marketing/check-redlines.mjs — 宣传素材红线自检
 *
 * 检查三类硬性要求：
 *   A. 每个文件首行必须是 <!-- STATUS: DRAFT — NOT POSTED -->
 *   B. 红线词不得以「肯定语境」出现
 *   C. 直接对外文案必须包含三件声明
 *
 * 关于「否定语境」（重要）
 *   产品定位要求文案必须写出「不是成功率、不是预测」这类否定声明，
 *   而红线清单又禁止出现「成功率」「预测」。这两条只在否定语境下才能同时成立。
 *   因此命中分两级：
 *     FAIL — 肯定语境（如「成功率达 80%」「预测你的未来」）
 *     WARN — 否定语境（需人工确认确实是否定/引用）
 *   判定规则：只看红线词**同一行之前**的文字里有没有否定标记。
 *   否定必须前置，否则「成功率很高，不是预测」会被误判为通过。
 *
 * 退出码：有 FAIL → 1；否则 0。WARN 不代表可发布，仍需人工复核。
 *
 * 零依赖。用法：node marketing/check-redlines.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATUS_LINE = '<!-- STATUS: DRAFT — NOT POSTED -->';

const RED_WORDS = [
  '成功率', '胜率', '概率', '准确率', '预测',
  '算出你的最佳选择', '最佳选择',
  'AI 帮你决定', '科学算命', '心理学测评',
  '已发布', '广受好评', '已有用户',
];

/** 必须是「前置」的否定/禁止/引用标记 */
const NEGATION_MARKERS = [
  '不是', '不算', '不预测', '不出现', '不写', '不把', '不做', '不提供',
  '不得', '不能', '不会', '不构成', '不代表', '不加',
  '没有', '并非', '而不是', '禁止', '避免', '误读', '误判', '被读成', '读成', '误导成',
  '红线', '绝对禁止', '不要',
];

const REQUIRED = [
  {
    id: 'own-input',
    label: '得分来自你自己的打分和你自己设的权重',
    patterns: [
      /你自己的打分/,
      /你自己打的/,
      /你自己设的权重/,
      /your own 0–10 ratings/i,
      /your own weights/i,
    ],
  },
  {
    id: 'not-probability',
    label: '不是成功率、不是预测',
    patterns: [/不是成功率/, /不是预测/, /not a success rate/i, /not a prediction/i],
  },
  {
    id: 'high-risk',
    label: '不适用于医疗/法律/财务等高风险决定',
    patterns: [
      /医疗[\s\S]{0,40}(法律|财务)/,
      /法律[\s\S]{0,40}(财务|医疗)/,
      /medical[\s\S]{0,60}(legal|financial)/i,
      /legal[\s\S]{0,60}(financial|medical)/i,
    ],
  },
];

/** 直接对外文案：必须含三件声明 */
const STRICT_FILES = new Set(['launch_zh.md', 'launch_en.md', 'developer_zh.md']);

/** 索引/工具本身在描述红线规则，不做红线词扫描 */
const SKIP_RED_WORD_SCAN = new Set(['README.md']);

function scanFile(name, text) {
  const lines = text.split(/\r?\n/);
  const failures = [];
  const warnings = [];

  const firstLine = (lines[0] ?? '').trim();
  if (firstLine !== STATUS_LINE) {
    failures.push({
      kind: 'STATUS',
      message: `首行不是状态标记。期望：${STATUS_LINE}；实际：「${firstLine.slice(0, 60)}」`,
    });
  }

  if (!SKIP_RED_WORD_SCAN.has(name)) {
    lines.forEach((line, idx) => {
      for (const word of RED_WORDS) {
        let from = 0;
        for (;;) {
          const col = line.indexOf(word, from);
          if (col === -1) break;
          from = col + word.length;

          const prefix = line.slice(0, col);
          const immediatelyNegated = /[不没无别勿]\s*\**\s*$/.test(prefix);
          const negated = immediatelyNegated || NEGATION_MARKERS.some((m) => prefix.includes(m));
          const ctxStart = Math.max(0, col - 30);
          const ctxEnd = Math.min(line.length, col + word.length + 30);
          const item = {
            line: idx + 1,
            word,
            context: line.slice(ctxStart, ctxEnd).trim(),
          };

          if (negated) {
            warnings.push({
              kind: 'WARN_NEGATED',
              message: `否定语境出现「${word}」——请人工确认确为否定/引用`,
              ...item,
            });
          } else {
            failures.push({
              kind: 'FAIL_AFFIRMATIVE',
              message: `肯定语境出现「${word}」`,
              ...item,
            });
          }
        }
      }
    });
  }

  if (STRICT_FILES.has(name)) {
    for (const req of REQUIRED) {
      if (!req.patterns.some((p) => p.test(text))) {
        failures.push({ kind: 'REQUIRED', message: `缺少必填声明：${req.label}` });
      }
    }
  }

  return { failures, warnings };
}

function main() {
  const files = readdirSync(HERE).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) {
    console.error('没有找到任何 .md 文件');
    process.exit(1);
  }

  let totalFail = 0;
  let totalWarn = 0;
  const report = [];

  for (const name of files) {
    const text = readFileSync(join(HERE, name), 'utf8');
    const r = scanFile(name, text);
    totalFail += r.failures.length;
    totalWarn += r.warnings.length;
    report.push({ name, ...r, bytes: Buffer.byteLength(text) });
  }

  console.log('='.repeat(72));
  console.log('宣传素材红线自检 / marketing redline check');
  console.log('='.repeat(72));

  for (const r of report) {
    const status = r.failures.length ? 'FAIL' : r.warnings.length ? 'REVIEW' : 'PASS';
    console.log(`\n[${status}] ${r.name}  (${r.bytes} bytes)`);
    for (const f of r.failures) {
      console.log(`  x ${f.message}`);
      if (f.line) console.log(`      L${f.line}: …${f.context}…`);
    }
    for (const w of r.warnings) {
      console.log(`  ! ${w.message}`);
      if (w.line) console.log(`      L${w.line}: …${w.context}…`);
    }
  }

  console.log('\n' + '-'.repeat(72));
  console.log(`文件数 ${files.length} ｜ FAIL ${totalFail} ｜ WARN ${totalWarn}`);
  console.log('-'.repeat(72));

  if (totalFail > 0) {
    console.log('\n结果：不通过。修掉所有 x 再谈发布。');
    process.exit(1);
  }
  console.log('\n结果：无硬性失败。');
  if (totalWarn > 0) {
    console.log(`仍有 ${totalWarn} 条 WARN 需人工逐条确认上下文确实是否定或界面原文引用。`);
    console.log('退出码 0 不等于文案已可发布。');
  }
  process.exit(0);
}

main();
