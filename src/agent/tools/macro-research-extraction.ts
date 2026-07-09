import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import type { DataStore } from "../data/store/data-store";
import { MACRO_RESEARCH_SOURCES, type MacroResearchSource } from "./macro-research-source-catalog";

type ExtractedDocument = {
  source: MacroResearchSource;
  url: string;
  listSourceUrl?: string;
  contentType: "html" | "pdf_text" | "api_payload";
  title: string;
  sourcePublishedAt: string | null;
  cleanedText: string;
  summary: string;
  keyClaims: Record<string, unknown>[];
  mentionedAssets: string[];
  mentionedRegions: string[];
  mentionedSectors: string[];
  contentHash: string;
  artifactPath: string | null;
  fetchedAt: string;
  confidence: string;
  limitation: string;
};

type ExtractionFailure = {
  source: MacroResearchSource;
  url: string;
  fetchedAt: string;
  failureClass: string;
  message: string;
};

const EXTRACTABLE_ACCESS_CLASSES = [
  "public-summary-licensed-full-report",
  "public-html-and-pdf",
  "public-html",
  "official-api",
  "official-public-source",
  "official-api-and-public-report",
  "browser-or-official-api",
  "browser-public",
];

const BLOCKED_ACCESS_MARKERS = [
  "anti-bot",
  "manual",
  "security",
];

export async function macroResearchExtract(
  ds: DataStore,
  input: Record<string, unknown> = {},
  basePath = "",
): Promise<string> {
  const sources = selectedSources(input);
  const fetchedAt = new Date().toISOString();
  const extracted: ExtractedDocument[] = [];
  const failures: ExtractionFailure[] = [];

  for (const source of sources) {
    const url = selectedUrl(source, input);
    if (!isExtractableSource(source)) {
      failures.push({
        source,
        url,
        fetchedAt,
        failureClass: source.accessClass,
        message: `Source is ${source.accessClass}; keep as retrieval evidence until a legitimate access path or manual artifact is provided.`,
      });
      continue;
    }
    try {
      extracted.push(await extractOneSource(source, url, input, basePath, fetchedAt));
    } catch (error) {
      failures.push({
        source,
        url,
        fetchedAt,
        failureClass: classifyExtractionError(error),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const rows = [
    ...extracted.flatMap((item) => evidenceRowsForExtracted(item)),
    ...failures.map((item) => failureEvidenceRow(item)),
  ];
  const shouldPersist = input.persist !== false;
  if (shouldPersist && rows.length > 0) ds.saveMarketMovingFactors(rows);
  return JSON.stringify(
    {
      action: "macro_research_extract",
      status: failures.length > 0 && extracted.length === 0 ? "failed" : "ok",
      extracted: extracted.length,
      failed: failures.length,
      persisted: shouldPersist,
      providerMatrix: buildExtractionProviderMatrix(),
      provenance: extractionProvenance("macro_research_extract"),
      rows,
      failures: failures.map((item) => ({
        provider: item.source.provider,
        providerName: item.source.providerName,
        url: item.url,
        failureClass: item.failureClass,
        message: item.message,
      })),
    },
    null,
    2,
  );
}

export function queryMacroResearchContent(
  ds: DataStore,
  input: Record<string, unknown> = {},
): string {
  const sourceFilter = sourceNameFilter(input);
  const rows = ds.queryMarketMovingFactors({
    families: [
      "macro_research_document",
      "macro_index_event",
      "macro_policy_event",
      "macro_official_series",
      "macro_commodity_event",
      "macro_source_retrieval_evidence",
    ],
    status: clean(input.status),
    source: sourceFilter,
    target: clean(input.target ?? input.query),
    assets: list(input.assets),
    regions: list(input.regions ?? input.market),
    sectors: list(input.sectors ?? input.industry),
    limit: limitOf(input.limit, 80),
  }).filter((row) => {
    const values = row.macro_values as Record<string, unknown> | null;
    if (input.contentOnly === false) return true;
    return Boolean(values && values.contentHash);
  });
  return JSON.stringify(
    {
      action: "query_macro_research_content",
      status: rows.length === 0 ? "missing" : "ok",
      count: rows.length,
      missingReason:
        rows.length === 0
          ? "No extracted macro research content rows matched the filters. Run macro_research_extract for an allowed source or inspect macro_research_extraction_status."
          : null,
      providerMatrix: buildExtractionProviderMatrix(),
      provenance: extractionProvenance("query_macro_research_content"),
      readbackContract: {
        normalUse:
          "Use contentEvidence for first-pass macro analysis. It contains title/date/source/key claims/body preview from governed readback, so local artifact files do not need to be opened.",
        diagnosticOnly:
          "artifactPath is for audit/debug/source maintenance. Do not use Glob/Read to inspect macro content files in a normal first-pass analysis answer.",
      },
      contentEvidence: rows.map(contentEvidenceRow),
      rows,
    },
    null,
    2,
  );
}

function contentEvidenceRow(row: Record<string, unknown>): Record<string, unknown> {
  const values = (row.macro_values ?? {}) as Record<string, unknown>;
  const claims = Array.isArray(values.keyClaims)
    ? values.keyClaims.slice(0, 5).map((claim) => {
        if (claim && typeof claim === "object") {
          const item = claim as Record<string, unknown>;
          return {
            claim: item.claim ?? item.text ?? null,
            category: item.claimCategory ?? item.category ?? null,
            confidence: item.confidence ?? null,
            limitation: item.limitation ?? null,
            sourceUrl: item.sourceUrl ?? row.source_url ?? null,
            sourceDate: item.sourceDate ?? row.source_published_at ?? null,
          };
        }
        return { claim: String(claim), category: null, confidence: null, limitation: null };
      })
    : [];
  return {
    title: row.title ?? values.title ?? null,
    summary: row.summary ?? null,
    sourceName: row.source_name ?? null,
    sourceUrl: row.source_url ?? null,
    sourceType: row.source_type ?? null,
    sourceDataTime: row.source_published_at ?? values.sourcePublishedAt ?? null,
    fetchedAt: row.fetched_at ?? values.retrievedAt ?? null,
    family: row.family ?? null,
    status: row.status ?? null,
    affectedAssets: row.affected_assets ?? values.mentionedAssets ?? [],
    affectedRegions: row.affected_regions ?? values.mentionedRegions ?? [],
    affectedSectors: row.affected_sectors ?? values.mentionedSectors ?? [],
    transmissionChannels: row.transmission_channels ?? [],
    contentHash: values.contentHash ?? null,
    bodyPreview: values.bodyPreview ?? null,
    bodyLength: values.bodyLength ?? null,
    keyClaims: claims,
    limitation:
      claims.find((claim) => claim.limitation)?.limitation ??
      ((row.retrieval_test as Record<string, unknown> | undefined)?.limitation ?? null),
    diagnosticArtifactPath: values.artifactPath ?? null,
  };
}

function sourceNameFilter(input: Record<string, unknown>): string | undefined {
  const raw = clean(input.source ?? input.provider);
  if (!raw) return undefined;
  const source = MACRO_RESEARCH_SOURCES.find((item) =>
    matches(item.provider, raw) || matches(item.providerName, raw)
  );
  return source?.providerName ?? raw;
}

export function macroResearchExtractionStatus(input: Record<string, unknown> = {}): string {
  const provider = clean(input.provider ?? input.source);
  const rows = buildExtractionProviderMatrix().filter((row) => {
    if (!provider) return true;
    return matches(String(row.provider), provider) || matches(String(row.providerName), provider);
  });
  return JSON.stringify(
    {
      action: "macro_research_extraction_status",
      status: rows.length === 0 ? "missing" : "ok",
      count: rows.length,
      provenance: extractionProvenance("macro_research_extraction_status"),
      rows,
    },
    null,
    2,
  );
}

async function extractOneSource(
  source: MacroResearchSource,
  url: string,
  input: Record<string, unknown>,
  basePath: string,
  fetchedAt: string,
): Promise<ExtractedDocument> {
  const injectedContent = clean(input.content ?? input.html ?? input.pdfText ?? input.apiPayload);
  const contentType = contentTypeFor(source, url, input);
  const document = injectedContent
    ? { text: injectedContent, url }
    : await fetchSourceDocument(source, url, contentType, input, basePath);
  const raw = document.text;
  const apiPayload = contentType === "api_payload" ? extractApiPayload(raw) : null;
  const textSource = contentType === "html" ? extractHtmlMainContent(raw) : raw;
  const cleanedText = apiPayload?.text ?? (contentType === "html" ? cleanHtml(textSource) : cleanDocumentText(raw));
  if (cleanedText.length < 120) {
    const sparseClass = contentType === "html" ? classifySparseHtml(raw) : "extraction-too-sparse";
    throw new MacroExtractionError(sparseClass, `Extracted text too short for ${source.provider}.`);
  }
  const sourcePublishedAt = apiPayload?.date ?? extractDate(raw) ?? extractDate(cleanedText) ?? extractDate(document.url);
  const title = apiPayload?.title ?? extractTitle(raw, cleanedText, source);
  const hash = sha256(`${document.url}\n${sourcePublishedAt ?? ""}\n${cleanedText}`);
  const artifactPath = writeContentArtifact(basePath, source.provider, hash, contentType, cleanedText);
  const keyClaims = extractKeyClaims(cleanedText, source, document.url, sourcePublishedAt, hash);
  return {
    source,
    url: document.url,
    listSourceUrl: document.listSourceUrl,
    contentType,
    title,
    sourcePublishedAt,
    cleanedText,
    summary: summarize(cleanedText),
    keyClaims,
    mentionedAssets: mentionedAssets(cleanedText, source),
    mentionedRegions: mentionedRegions(cleanedText, source),
    mentionedSectors: mentionedSectors(cleanedText, source),
    contentHash: hash,
    artifactPath,
    fetchedAt,
    confidence: confidenceFor(cleanedText, source),
    limitation: source.limitation,
  };
}

async function fetchSourceDocument(
  source: MacroResearchSource,
  url: string,
  contentType: "html" | "pdf_text" | "api_payload",
  input: Record<string, unknown>,
  basePath: string,
): Promise<{ text: string; url: string; listSourceUrl?: string }> {
  const listText = await fetchSourceText(source, url, contentType, basePath);
  if (contentType !== "html" || input.disableDetailDiscovery === true || !shouldDiscoverDetailUrl(source, url)) {
    return { text: listText, url };
  }
  const detailUrl = selectMacroResearchDetailUrlForTest({
    sourceUrl: url,
    html: listText,
    source,
  });
  if (!detailUrl || detailUrl === url) return { text: listText, url };
  const detailText = await fetchSourceText(source, detailUrl, contentType, basePath);
  return { text: detailText, url: detailUrl, listSourceUrl: url };
}

async function fetchSourceText(
  source: MacroResearchSource,
  url: string,
  contentType: "html" | "pdf_text" | "api_payload",
  basePath: string,
): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": source.defaultUserAgentRequired
      ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
      : "FinAgentResearchProvenance/1.0",
    "Accept": contentType === "pdf_text" ? "application/pdf,*/*" : "text/html,application/xhtml+xml,application/json,*/*",
  };
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new MacroExtractionError(
      response.status === 401 || response.status === 403 ? "security-or-permission-blocked" : "http-error",
      `HTTP ${response.status} while fetching ${url}`,
    );
  }
  if (contentType === "pdf_text") {
    const bytes = Buffer.from(await response.arrayBuffer());
    return extractTextFromPdfBytes(bytes, basePath);
  }
  return response.text();
}

function shouldDiscoverDetailUrl(source: MacroResearchSource, url: string): boolean {
  if (/\.pdf(?:$|\?)/i.test(url)) return false;
  return source.categories.some((item) =>
    [
      "data_release",
      "official_policy_event",
      "policy_report",
      "open_market_operations",
      "market_structure_event",
      "central_bank_communication",
      "capital_market_policy",
    ].includes(item)
  );
}

export function selectMacroResearchDetailUrlForTest(input: {
  sourceUrl: string;
  html: string;
  source: MacroResearchSource;
}): string | null {
  let base: URL;
  try {
    base = new URL(input.sourceUrl);
  } catch {
    return null;
  }
  const candidates: Array<{ url: string; score: number; dateScore: number; order: number }> = [];
  let order = 0;
  for (const match of input.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    order += 1;
    const attrs = match[1] ?? "";
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let resolved: URL;
    try {
      resolved = new URL(htmlDecode(href), base);
    } catch {
      continue;
    }
    if (!isSameOfficialOrigin(base, resolved) || !isAllowedDetailPath(resolved)) continue;
    const text = cleanHtml(match[2] ?? "");
    const score = detailLinkScore(resolved);
    if (score <= 0) continue;
    candidates.push({ url: resolved.toString(), score, dateScore: detailPathDateScore(resolved), order });
  }
  candidates.sort((a, b) => b.dateScore - a.dateScore || b.score - a.score || a.order - b.order);
  return candidates[0]?.url ?? null;
}

function isSameOfficialOrigin(base: URL, next: URL): boolean {
  return next.protocol === base.protocol && next.host === base.host;
}

function isAllowedDetailPath(url: URL): boolean {
  const raw = url.toString().toLowerCase();
  if (
    raw.includes("#") ||
    raw.startsWith("javascript:") ||
    raw.startsWith("mailto:") ||
    raw.includes("/wza/") ||
    raw.includes("/mobile/") ||
    raw.includes("rss") ||
    raw.includes("login") ||
    raw.includes("search")
  ) {
    return false;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  const last = segments[segments.length - 1].toLowerCase();
  if (last === "index.html") return segments.length >= 5;
  return last.endsWith(".html") || last.endsWith(".shtml");
}

function detailLinkScore(url: URL): number {
  let score = 0;
  if (/20\d{2}/.test(url.pathname)) score += 3;
  if (url.pathname.split("/").filter(Boolean).length >= 3 && url.pathname.endsWith(".html")) score += 2;
  if (url.pathname.endsWith(".shtml")) score += 1;
  if (url.pathname.endsWith("index.html")) score -= 4;
  return score;
}

function detailPathDateScore(url: URL): number {
  const compact = url.pathname.match(/(20\d{2})([01]\d)([0-3]\d)/);
  if (compact) return Number(`${compact[1]}${compact[2]}${compact[3]}`) || 0;
  const yearMonth = url.pathname.match(/(20\d{2})([01]\d)/);
  if (yearMonth) return Number(`${yearMonth[1]}${yearMonth[2]}00`) || 0;
  return 0;
}

function htmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function evidenceRowsForExtracted(item: ExtractedDocument): Record<string, unknown>[] {
  const family = contentFamily(item.source) ?? "macro_research_document";
  const interfaceId = interfaceForFamily(family);
  return [
    {
      factor_id: `macro:content:${item.source.provider}:${item.contentHash.slice(0, 16)}`,
      family,
      title: item.title,
      summary: item.summary,
      source_name: item.source.providerName,
      source_url: item.url,
      source_type: item.source.evidenceValue,
      source_published_at: item.sourcePublishedAt,
      fetched_at: item.fetchedAt,
      affected_assets: item.mentionedAssets,
      affected_regions: item.mentionedRegions,
      affected_sectors: item.mentionedSectors,
      transmission_channels: transmissionChannels(item.source),
      expected_direction: "context",
      severity: item.keyClaims.length >= 3 ? "medium" : "low",
      confidence: item.confidence,
      status: "usable",
      evidence_items: item.keyClaims,
      macro_values: {
        interfaceId,
        ...(item.listSourceUrl ? { listSourceUrl: item.listSourceUrl } : {}),
        title: item.title,
        contentType: item.contentType,
        contentHash: item.contentHash,
        artifactPath: item.artifactPath,
        bodyPreview: item.cleanedText.slice(0, 1800),
        bodyLength: item.cleanedText.length,
        keyClaims: item.keyClaims,
        mentionedAssets: item.mentionedAssets,
        mentionedRegions: item.mentionedRegions,
        mentionedSectors: item.mentionedSectors,
        sourceCategories: item.source.categories,
        sourcePublishedAt: item.sourcePublishedAt,
        retrievedAt: item.fetchedAt,
        parserVersion: "macro-research-extractor-v1",
      },
      retrieval_test: {
        interface_id: interfaceId,
        capability_id: `${item.source.provider}.${interfaceId}.extract`,
        provider: item.source.provider,
        providerName: item.source.providerName,
        status: "extracted",
        accessClass: item.source.accessClass,
        retrievalMethods: item.source.retrievalMethods,
        automationPolicy: item.source.automationPolicy,
        contentHash: item.contentHash,
        contentType: item.contentType,
        ...(item.listSourceUrl ? { listSourceUrl: item.listSourceUrl } : {}),
        canonical_schema: "market_moving_factor_v1",
        canonical_table: "market_moving_factor",
        readback_action: "query_macro_research_content",
        fetched_at: item.fetchedAt,
      },
      raw_json: {
        provider: item.source.provider,
        url: item.url,
        ...(item.listSourceUrl ? { listSourceUrl: item.listSourceUrl } : {}),
        contentHash: item.contentHash,
        artifactPath: item.artifactPath,
        keyClaims: item.keyClaims,
      },
    },
  ];
}

function failureEvidenceRow(item: ExtractionFailure): Record<string, unknown> {
  return {
    factor_id: `macro:source_extraction:${item.source.provider}`,
    family: "macro_source_retrieval_evidence",
    title: `${item.source.providerName} extraction status`,
    summary: item.message,
    source_name: item.source.providerName,
    source_url: item.url,
    source_type: "source_extraction_evidence",
    fetched_at: item.fetchedAt,
    affected_assets: affectedAssets(item.source),
    affected_regions: affectedRegions(item.source),
    affected_sectors: item.source.categories,
    transmission_channels: ["source extraction", item.source.evidenceValue],
    expected_direction: "context",
    severity: "medium",
    confidence: "high",
    status: "blocked",
    failure_class: item.failureClass,
    evidence_items: [{
      sourceUrl: item.url,
      sourceTitle: `${item.source.providerName} extraction status`,
      retrievalMethod: item.source.retrievalMethods[0],
      accessClass: item.source.accessClass,
      testedStatus: item.source.testedStatus,
      limitation: item.source.limitation,
      nextAction: item.source.nextAction,
    }],
    macro_values: {
      interfaceId: "macro.source_retrieval_evidence",
      extractionStatus: "not-extracted",
      failureClass: item.failureClass,
      message: item.message,
      retrievedAt: item.fetchedAt,
    },
    retrieval_test: {
      interface_id: "macro.source_retrieval_evidence",
      capability_id: `${item.source.provider}.macro.source_extraction`,
      provider: item.source.provider,
      providerName: item.source.providerName,
      status: "blocked",
      failure_class: item.failureClass,
      accessClass: item.source.accessClass,
      canonical_schema: "market_moving_factor_v1",
      canonical_table: "market_moving_factor",
      readback_action: "query_macro_research_evidence",
      fetched_at: item.fetchedAt,
    },
    raw_json: { source: item.source, message: item.message },
  };
}

function selectedSources(input: Record<string, unknown>): MacroResearchSource[] {
  const provider = clean(input.provider ?? input.source ?? input.sourceId);
  const category = clean(input.category ?? input.family);
  const maxPriority = numberOf(input.priority);
  let candidates = MACRO_RESEARCH_SOURCES;
  if (provider && provider !== "all") {
    const exact = MACRO_RESEARCH_SOURCES.filter(
      (source) => equalsFold(source.provider, provider) || equalsFold(source.providerName, provider),
    );
    if (exact.length > 0) candidates = exact;
  }
  const rows = candidates.filter((source) => {
    if (provider && provider !== "all" && !matches(source.provider, provider) && !matches(source.providerName, provider)) return false;
    if (category && !source.categories.some((item) => matches(item, category))) return false;
    if (maxPriority && source.priority > maxPriority) return false;
    return true;
  });
  return rows.slice(0, limitOf(input.limit, provider ? 20 : 80));
}

function equalsFold(left: unknown, right: string): boolean {
  return `${left ?? ""}`.trim().toLowerCase() === right.trim().toLowerCase();
}

function selectedUrl(source: MacroResearchSource, input: Record<string, unknown>): string {
  const url = clean(input.url);
  if (url) return url;
  const index = Math.max(0, Math.min(numberOf(input.urlIndex) ?? 0, source.entryUrls.length - 1));
  return source.entryUrls[index] ?? "";
}

function isExtractableSource(source: MacroResearchSource): boolean {
  if (source.accessClass.includes("licensed") && !source.accessClass.includes("public-summary")) return false;
  if (BLOCKED_ACCESS_MARKERS.some((marker) => source.accessClass.includes(marker))) return false;
  if (source.automationPolicy.includes("do-not-scrape")) return false;
  return EXTRACTABLE_ACCESS_CLASSES.some((item) => source.accessClass.includes(item));
}

function contentTypeFor(
  source: MacroResearchSource,
  url: string,
  input: Record<string, unknown>,
): "html" | "pdf_text" | "api_payload" {
  const explicit = clean(input.contentType);
  if (explicit === "pdf_text" || explicit === "html" || explicit === "api_payload") return explicit;
  if (/\.pdf(?:$|\?)/i.test(url) || clean(input.pdfText)) return "pdf_text";
  if (source.retrievalMethods.includes("official_api") && clean(input.apiPayload)) return "api_payload";
  return "html";
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractHtmlMainContent(html: string): string {
  const containers = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<section\b[^>]*(?:class|id)=["'][^"']*(?:article|content|detail|main|text|zoom|TRS_Editor)[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:TRS_Editor|Custom_UnionStyle|zoom|article|content|detail|mainText|news_txt|txt|text)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:TRS_Editor|Custom_UnionStyle|zoom|article|content|detail|mainText|news_txt|txt|text)[^"']*["'][^>]*>([\s\S]*)<\/div>/i,
  ];
  for (const pattern of containers) {
    const match = html.match(pattern)?.[1];
    if (match && cleanHtml(match).length >= 120) return match;
  }
  return html;
}

function classifySparseHtml(html: string): string {
  const lower = html.toLowerCase();
  const attachmentLinks = [...html.matchAll(/<a\b[^>]*href=["'][^"']+\.(?:pdf|xls|xlsx|doc|docx|csv|zip)(?:\?[^"']*)?["'][^>]*>/gi)].length;
  if (attachmentLinks > 0 || /附件|下载|download|attachment/.test(lower)) {
    return "attachment-only-source";
  }
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const linkCount = (html.match(/<a\b/gi) ?? []).length;
  const paragraphCount = (html.match(/<p\b/gi) ?? []).length;
  if (scriptCount >= 2 && paragraphCount === 0) return "javascript-rendered-list";
  if (linkCount >= 8 && paragraphCount === 0) return "list-page-without-detail";
  return "extraction-too-sparse";
}

function cleanDocumentText(text: string): string {
  return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function extractApiPayload(raw: string): { title?: string; date?: string; text: string } | null {
  try {
    const decoded = JSON.parse(raw);
    const title = firstJsonString(decoded, ["title", "articleTitle", "noticeTitle", "headline", "name"]);
    const dateText = firstJsonString(decoded, ["publishDate", "publishTime", "pubDate", "date", "releaseDate", "showTime", "time"]);
    const date = dateText ? extractDate(dateText) : null;
    const parts: string[] = [];
    collectJsonText(decoded, parts);
    const text = cleanDocumentText(parts.join("\n"));
    if (text.length === 0) return null;
    return { title: title ? cleanHtml(title).slice(0, 220) : undefined, date: date ?? undefined, text };
  } catch {
    return null;
  }
}

function firstJsonString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstJsonString(item, keys);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const foundKey = Object.keys(record).find((item) => item.toLowerCase() === key.toLowerCase());
    const item = foundKey ? record[foundKey] : undefined;
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  for (const item of Object.values(record)) {
    const found = firstJsonString(item, keys);
    if (found) return found;
  }
  return null;
}

function collectJsonText(value: unknown, parts: string[], key = ""): void {
  if (parts.length > 80 || value == null) return;
  if (typeof value === "string") {
    const text = cleanHtml(value);
    if (text.length >= 8 && !/^https?:\/\//i.test(text)) {
      parts.push(key ? `${key}: ${text}` : text);
    }
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    if (key) parts.push(`${key}: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonText(item, parts, key);
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (/^(id|uuid|url|href|link|path|image|img|file)$/i.test(childKey)) continue;
      collectJsonText(childValue, parts, childKey);
    }
  }
}

function extractTextFromPdfBytes(bytes: Buffer, tempDir: string): string {
  const latin = bytes.toString("latin1");
  const literalText = [...latin.matchAll(/\(([^()]{4,})\)\s*Tj/g)].map((match) => match[1]);
  const arrayText = [...latin.matchAll(/\[((?:\([^()]*\)\s*){2,})\]\s*TJ/g)]
    .flatMap((match) => [...match[1].matchAll(/\(([^()]*)\)/g)].map((item) => item[1]));
  const text = [...literalText, ...arrayText].join(" ");
  const simple = text.replace(/\\\)/g, ")").replace(/\\\(/g, "(").replace(/\\n/g, "\n").trim();
  if (simple.length >= 120 || !tempDir) return simple;
  return extractTextWithPdftotext(bytes, tempDir);
}

function extractTextWithPdftotext(bytes: Buffer, tempDir: string): string {
  try {
    const dir = join(tempDir, "data", "macro_research_content", "_tmp");
    mkdirSync(dir, { recursive: true });
    const hash = sha256(bytes.toString("base64")).slice(0, 16);
    const pdfPath = join(dir, `${hash}.pdf`);
    const txtPath = join(dir, `${hash}.txt`);
    writeFileSync(pdfPath, bytes);
    execFileSync("pdftotext", ["-layout", pdfPath, txtPath], { timeout: 20_000 });
    return cleanDocumentText(readFileSync(txtPath, "utf8"));
  } catch {
    return "";
  }
}

function extractTitle(raw: string, cleaned: string, source: MacroResearchSource): string {
  const metaTitle = extractMetaContent(raw, [
    "ArticleTitle",
    "article:title",
    "og:title",
    "twitter:title",
    "title",
  ]);
  const titleTag = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const h2 = raw.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  const firstLine = cleaned.split(/[.!?\n。]/).find((line) => line.trim().length > 8);
  const text = cleanHtml(h1 ?? h2 ?? metaTitle ?? titleTag ?? firstLine ?? `${source.providerName} macro research content`)
    .replace(/\s*[-_—|]\s*(中国人民银行|国家统计局|证监会|外汇管理局|上海证券交易所|深圳证券交易所|香港交易所|People's Bank of China|National Bureau of Statistics).*$/i, "")
    .replace(/\s*(发布时间|发布日期|发文日期|更新时间|日期|时间|来源)\s*[：:].*$/i, "")
    .trim();
  return text.slice(0, 220);
}

function extractDate(text: string): string | null {
  const metaDate = extractMetaContent(text, [
    "PubDate",
    "publishdate",
    "publishDate",
    "date",
    "article:published_time",
    "og:pubdate",
  ]);
  if (metaDate) {
    const parsed = extractDateWithoutMeta(metaDate);
    if (parsed) return parsed;
  }
  const labeled = text.match(/(?:发布时间|发布日期|发文日期|更新时间|日期|时间)\s*[：:]\s*(20\d{2})\s*年\s*(0?[1-9]|1[0-2])\s*月\s*(0?[1-9]|[12]\d|3[01])\s*日?/);
  if (labeled) return `${labeled[1]}-${labeled[2].padStart(2, "0")}-${labeled[3].padStart(2, "0")}`;
  return extractDateWithoutMeta(text);
}

function extractDateWithoutMeta(text: string): string | null {
  const iso = text.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const chinese = text.match(/\b(20\d{2})\s*年\s*(0?[1-9]|1[0-2])\s*月\s*(0?[1-9]|[12]\d|3[01])\s*日?\b/);
  if (chinese) return `${chinese[1]}-${chinese[2].padStart(2, "0")}-${chinese[3].padStart(2, "0")}`;
  const compact = text.match(/(?:^|[^\d])(20\d{2})(0[1-9]|1[0-2])([0-3]\d)(?:[^\d]|$)/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const month = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-3]?\d),\s+(20\d{2})\b/i);
  if (!month) return null;
  const m = ["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(month[1].toLowerCase()) + 1;
  return `${month[3]}-${String(m).padStart(2, "0")}-${month[2].padStart(2, "0")}`;
}

function extractMetaContent(raw: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameFirst = new RegExp(`<meta\\b[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
    const contentFirst = new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`, "i");
    const value = raw.match(nameFirst)?.[1] ?? raw.match(contentFirst)?.[1];
    if (value?.trim()) return value.trim();
  }
  return null;
}

function extractKeyClaims(
  text: string,
  source: MacroResearchSource,
  url: string,
  sourceDate: string | null,
  contentHash: string,
): Record<string, unknown>[] {
  const sentences = text.split(/(?<=[.!?。])\s+/).map((item) => item.trim()).filter((item) => item.length > 35);
  const picked = sentences.slice(0, 6).map((sentence, index) => ({ sentence, index }));
  return picked.map((item) => ({
    claim: item.sentence.slice(0, 600),
    claimCategory: source.evidenceValue,
    mentionedEntities: [...new Set([...affectedAssets(source), ...affectedRegions(source)])],
    citedSource: { url, paragraphIndex: item.index },
    confidence: "unassessed",
    limitation: source.limitation,
    sourceUrl: url,
    sourceDate,
    contentHash,
  }));
}

function summarize(text: string): string {
  const sentences = text.split(/(?<=[.!?。])\s+/).map((item) => item.trim()).filter(Boolean);
  return sentences.slice(0, 3).join(" ").slice(0, 900);
}

function writeContentArtifact(
  basePath: string,
  provider: string,
  hash: string,
  contentType: string,
  text: string,
): string | null {
  if (!basePath) return null;
  const dir = join(basePath, "data", "macro_research_content", provider);
  mkdirSync(dir, { recursive: true });
  const filename = `${hash.slice(0, 16)}.${contentType === "pdf_text" ? "txt" : "html.txt"}`;
  const path = join(dir, filename);
  writeFileSync(path, text, "utf8");
  return path;
}

function buildExtractionProviderMatrix(): Record<string, unknown>[] {
  return MACRO_RESEARCH_SOURCES.map((source) => {
    const family = contentFamily(source);
    const allowed = isExtractableSource(source);
    return {
      provider: source.provider,
      providerName: source.providerName,
      catalogStatus: source.testedStatus,
      allowedRetrievalMethod: source.retrievalMethods[0] ?? null,
      contentExtractorStatus: allowed && family ? "implemented" : "not-extracted",
      pdfExtractorStatus: source.entryUrls.some((url) => /\.pdf(?:$|\?)/i.test(url)) ? "minimal-text-parser" : "not-applicable",
      keyClaimExtractorStatus: allowed && family ? "bounded-structural-extraction" : "not-extracted",
      contentHashReadbackStatus: allowed && family ? "supported" : "retrieval-evidence-only",
      canonicalEvidenceFamily: family ?? "macro_source_retrieval_evidence",
      limitation: source.limitation,
    };
  });
}

function contentFamily(source: MacroResearchSource): string | null {
  if (["research_narrative", "allocation_regime", "rates_credit_context"].includes(source.evidenceValue)) return "macro_research_document";
  if (source.evidenceValue === "official_index_event") return "macro_index_event";
  if (source.evidenceValue === "official_policy_event") return "macro_policy_event";
  if (source.evidenceValue === "official_macro_fact") return "macro_official_series";
  if (source.evidenceValue.includes("commodity") && isExtractableSource(source)) return "macro_commodity_event";
  return null;
}

function interfaceForFamily(family: string): string {
  switch (family) {
    case "macro_research_document":
      return "macro.research_document";
    case "macro_index_event":
      return "macro.index_event";
    case "macro_policy_event":
      return "macro.policy_event";
    case "macro_official_series":
      return "macro.official_series";
    case "macro_commodity_event":
      return "macro.commodity_event";
    default:
      return "macro.source_retrieval_evidence";
  }
}

function confidenceFor(text: string, source: MacroResearchSource): string {
  if (text.length > 1200 && source.testedStatus.includes("ok")) return "medium";
  if (text.length > 600) return "low-medium";
  return "low";
}

function mentionedAssets(_text: string, source: MacroResearchSource): string[] {
  return affectedAssets(source);
}

function mentionedRegions(_text: string, source: MacroResearchSource): string[] {
  return affectedRegions(source);
}

function mentionedSectors(_text: string, source: MacroResearchSource): string[] {
  return [...source.categories];
}

function affectedAssets(source: MacroResearchSource): string[] {
  switch (source.evidenceValue) {
    case "official_index_event": return ["index/passive flows"];
    case "official_policy_event": return ["macro policy"];
    case "official_macro_fact": return ["macro indicators"];
    case "commodity_supply_chain":
    case "commodity_market_structure": return ["commodities"];
    case "rates_credit_context": return ["rates/bonds"];
    case "allocation_regime": return ["multi-asset"];
    default: return ["global macro"];
  }
}

function affectedRegions(source: MacroResearchSource): string[] {
  if (source.provider === "bea" || source.provider === "fred" || source.provider === "bls") return ["United States"];
  return ["global"];
}

function transmissionChannels(source: MacroResearchSource): string[] {
  const channels = ["macro research evidence", source.evidenceValue];
  if (source.evidenceValue === "official_index_event") channels.push("passive benchmark flow");
  if (source.evidenceValue.includes("commodity")) channels.push("supply demand inventory");
  if (source.categories.some((item) => item.includes("rates") || item.includes("credit"))) channels.push("rates liquidity");
  if (source.categories.some((item) => item.includes("policy") || item.includes("regulation"))) channels.push("policy/regulation");
  if (source.categories.some((item) => item.includes("fx") || item.includes("capital_flow") || item.includes("external_balance"))) channels.push("fx/cross-border flows");
  return channels;
}

function extractionProvenance(readbackAction: string): Record<string, unknown> {
  return {
    interfaceId: "macro.research_content_extraction",
    providerId: "local",
    provider: "local",
    capabilityId: `local.${readbackAction}`,
    providerMode: "source-specific-extraction",
    cacheStatus: "content-hash-readback",
    cacheDecision: "reuse extracted source content when content hash/source date match",
    canonicalSchema: "market_moving_factor_v1",
    canonicalTable: "market_moving_factor",
    readbackAction,
    source: "allowed macro research source catalog",
    fetchedAt: new Date().toISOString(),
  };
}

function classifyExtractionError(error: unknown): string {
  if (error instanceof MacroExtractionError) return error.failureClass;
  if (error instanceof Error && error.name === "TimeoutError") return "transport-timeout";
  return "extraction-failed";
}

class MacroExtractionError extends Error {
  constructor(readonly failureClass: string, message: string) {
    super(message);
    this.name = "MacroExtractionError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

function list(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => clean(item)).filter((item): item is string => Boolean(item));
    return items.length > 0 ? items : undefined;
  }
  const text = clean(value);
  if (!text) return undefined;
  const items = text.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function limitOf(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 80));
}

function numberOf(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function matches(value: string, filter: string): boolean {
  return value.toLowerCase().includes(filter.toLowerCase());
}
