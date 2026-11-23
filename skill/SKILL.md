---
name: essay-review
description: 作文片段评测：上传手写照片或粘贴文字，按字体工整、卷面整洁、语句、用词、标点、结构、内容等维度评分，并给出具体改法与升格示范。用户要求批改作文、点评书写、评价卷面或需要修改建议时使用。
---

# 作文片段评测

这个插件把「批改一段作文」做成一条可重复的流程：给出片段 → 多维度评分 → 具体修改建议 → 升格示范。

## 什么时候用

- 用户上传手写作文照片，想评价字迹、卷面、语言和内容。
- 用户粘贴一段文字，想让你像老师一样批改并给出改法。
- 用户想把上次的评测结果找出来，或对比多次评测。

## 工具

| 工具 | 用途 |
| --- | --- |
| `essay_review__evaluate_text` | 评测文字片段，参数 `text`，可选 `grade`、`title`、`requirements`、`focus` |
| `essay_review__evaluate_image` | 评测本机手写照片，参数 `path`（绝对路径），可选同上 |
| `essay_review__list_reviews` | 列出历史记录，可传 `query` 搜索 |
| `essay_review__get_review` | 读取一条完整记录 |
| `essay_review__delete_review` | 删除记录 |

`grade` 取 `小学低年级`、`小学高年级`、`初中`、`高中`、`其他`，默认初中。
`focus` 是维度 key 数组，例如 `["handwriting","language"]`；图片模式可用
`handwriting`、`neatness`、`language`、`vocabulary`、`punctuation`、`structure`、`content`；
文字模式可用 `language`、`vocabulary`、`punctuation`、`structure`、`content`、`expression`。

## 使用要点

1. 图片评测需要当前模型支持图片输入；如果工具报 `model/no-vision`，改用文字评测，或请用户换视觉模型。
2. 图片模式下工具会先转录再评分，转录结果在 `text` 字段里；转录有误时，把修正后的文字交给 `essay_review__evaluate_text` 重评。
3. 把结果讲给用户时，先报总分与等级，再说最值得改的两三处，最后给可执行的下一步；不要把 JSON 原样贴出来。
4. 用户没有提供题目时不要编造题目；`title` 留空即可。
5. 评测结果保存在 profile 的 `essay-review-workshop` 目录里，`essay_review__list_reviews` 能找回。

## 结果字段

`overall`（0–100）、`level`（优秀/良好/中等/及格/待提高）、`summary`（总评）、
`dimensions`（逐项 `score`/`max`/`comment`/`suggestions`）、`highlights`（亮点）、
`issues`（问题：`quote`/`problem`/`advice`）、`rewrite`（升格示范）、`nextSteps`（练习建议）、
`transcription`（图片模式的识别文本）。
