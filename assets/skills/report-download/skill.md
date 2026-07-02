---
description: Desktop financial-report PDF acquisition workflow for FinAgent Workstation. Use when the user wants annual, interim, or quarterly report PDFs for A-share or Hong Kong listed companies.
when_to_use: User asks to download a report PDF, annual report, interim report, quarterly report, or wants a local PDF path for later reading or parsing.
---

# Financial Report PDF Download

The current desktop capability is:

1. use `Research(action:"search")` to find candidate PDF links
2. use `ReportDownload(url: ...)` to download the PDF
3. for reading, prefer `PageRender`, `WebView`, or an external text-extraction step

Do not assume `ReportDownload` will auto-search, and do not assume `ReportParse` is already a complete PDF parser.

## What is actually implemented

### Implemented

- `Research(action:"search")` for finding PDF leads
- `ReportDownload(url: ..., outputPath: ...)` for downloading a known PDF

### Not fully implemented

- `ReportDownload(code: ...)` as automatic search plus download
- `ReportParse` as a complete text-extraction and structured-analysis pipeline

## Recommended workflow

### 1. Search for the PDF first

```text
Research(action: "search", query: "site:stockn.xueqiu.com SH600887 2024 annual report pdf")
Research(action: "search", query: "site:notice.10jqka.com.cn Yili 2024 annual report pdf")
```

Filter for real PDF links such as:

- `stockn.xueqiu.com/...pdf`
- `notice.10jqka.com.cn/...pdf`

Exclude:

- summaries
- corrections
- audit opinions
- ESG / sustainability files
- shareholder-meeting documents

### 2. Download the PDF

```text
ReportDownload(
  url: "<PDF_URL>",
  outputPath: "{{DATA_DIR}}/memory/financeReport/600887_annual_2024/original.pdf"
)
```

If the user did not give a save path, allow the tool to generate the default path.

### 3. Read or post-process

Do not treat `ReportParse` as the current end-to-end answer. Prefer:

- `PageRender`
- `WebView` or dashboard display
- an explicit statement that extra text extraction is still needed

## Output requirements

Tell the user clearly:

- whether the download succeeded
- the saved file path
- the source website
- the report type and year
- whether the PDF has actually been parsed yet

Example:

```text
Downloaded the 2024 annual-report PDF.
- Company: Yili
- Source: Xueqiu PDF
- File: {{DATA_DIR}}/memory/financeReport/600887_annual_2024/original.pdf
- Status: download complete; text extraction still needs a separate PDF-processing step
```

## Avoid these mistakes

- do not call `ReportDownload(code: ...)` and pretend it will auto-search
- do not present `ReportParse(path: ...)` as a fully reliable desktop parser if the pipeline is not there
- do not claim success before you actually have a PDF URL
- do not claim the report content has already been analyzed if it has only been downloaded
