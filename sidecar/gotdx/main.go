package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bensema/gotdx"
)

var client *gotdx.Client
var exClient *gotdx.Client
var macClient *gotdx.Client
var recoveryMu sync.Mutex
var configuredMainHost string
var configuredMainPool []string
var configuredExHost string
var configuredExPool []string

type tdxServerEntry struct {
	Host string `json:"host"`
	Port int    `json:"port"`
	Name string `json:"name"`
}

const (
	maxSecurityBarsCount = uint16(500)
	maxIndexBarsCount    = uint16(800)
)

// Rate limiter — TDX uses single TCP connection, must serialize requests
type tdxLimiter struct {
	mu              sync.Mutex
	minInterval     time.Duration
	maxInterval     time.Duration
	currentInterval time.Duration
	lastCall        time.Time
	errors          int
	totalCalls      int64
	totalErrors     int64
}

var stdLimiter = &tdxLimiter{
	minInterval:     200 * time.Millisecond,
	maxInterval:     5 * time.Second,
	currentInterval: 200 * time.Millisecond,
}

var exLimiter = &tdxLimiter{
	minInterval:     200 * time.Millisecond,
	maxInterval:     5 * time.Second,
	currentInterval: 200 * time.Millisecond,
}

var macLimiter = &tdxLimiter{
	minInterval:     200 * time.Millisecond,
	maxInterval:     5 * time.Second,
	currentInterval: 200 * time.Millisecond,
}

func (l *tdxLimiter) wait() {
	l.mu.Lock()
	defer l.mu.Unlock()
	elapsed := time.Since(l.lastCall)
	if elapsed < l.currentInterval {
		time.Sleep(l.currentInterval - elapsed)
	}
	l.lastCall = time.Now()
	l.totalCalls++
}

func (l *tdxLimiter) onSuccess() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.errors = 0
	if l.currentInterval > l.minInterval {
		l.currentInterval = time.Duration(float64(l.currentInterval) * 0.9)
		if l.currentInterval < l.minInterval {
			l.currentInterval = l.minInterval
		}
	}
}

func (l *tdxLimiter) onError() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.errors++
	l.totalErrors++
	if l.errors >= 3 {
		l.currentInterval = time.Duration(float64(l.currentInterval) * 1.5)
		if l.currentInterval > l.maxInterval {
			l.currentInterval = l.maxInterval
		}
	}
}

func (l *tdxLimiter) status() map[string]interface{} {
	l.mu.Lock()
	defer l.mu.Unlock()
	return map[string]interface{}{
		"current_interval_ms": l.currentInterval.Milliseconds(),
		"min_interval_ms":     l.minInterval.Milliseconds(),
		"consecutive_errors":  l.errors,
		"total_calls":         l.totalCalls,
		"total_errors":        l.totalErrors,
	}
}

func main() {
	port := "19801"
	if len(os.Args) > 1 {
		port = os.Args[1]
	}

	mainAddresses := loadServerAddresses("TDX_SERVER_LIST", "tdx_servers.json", gotdx.MainHostAddresses())
	host, mainPool := primaryAndPool(mainAddresses)
	if v := os.Getenv("TDX_HOST"); v != "" {
		host = v
		mainPool = withoutAddress(mainAddresses, v)
	}

	configuredMainHost = host
	configuredMainPool = mainPool

	exAddresses := loadServerAddresses("TDX_EX_SERVER_LIST", "tdx_ex_servers.json", gotdx.ExHostAddresses())
	exHost, exPool := primaryAndPool(exAddresses)
	if v := os.Getenv("TDX_EX_HOST"); v != "" {
		exHost = v
		exPool = withoutAddress(exAddresses, v)
	}
	configuredExHost = exHost
	configuredExPool = exPool

	// --- Health ---
	http.HandleFunc("/health", handleHealth)
	http.HandleFunc("/help", handleHelp)
	http.HandleFunc("/rate_limit/status", handleRateLimitStatus)

	// --- Standard Quote ---
	http.HandleFunc("/quote", handleQuote)
	http.HandleFunc("/quotes", handleQuotes)
	http.HandleFunc("/kline", handleKline)
	http.HandleFunc("/kline_advanced", handleKlineAdvanced)
	http.HandleFunc("/index_bars", handleIndexBars)
	http.HandleFunc("/count", handleCount)
	http.HandleFunc("/finance", handleFinance)
	http.HandleFunc("/stock_list", handleStockList)
	http.HandleFunc("/stock_list_range", handleStockListRange)
	http.HandleFunc("/volume_profile", handleVolumeProfile)
	http.HandleFunc("/quotes_list", handleQuotesList)
	http.HandleFunc("/top_board", handleTopBoard)
	http.HandleFunc("/unusual", handleUnusual)
	http.HandleFunc("/auction", handleAuction)

	// --- Tick / Transaction ---
	http.HandleFunc("/tick_chart", handleTickChart)
	http.HandleFunc("/history_tick_chart", handleHistoryTickChart)
	http.HandleFunc("/transactions", handleTransactions)
	http.HandleFunc("/history_transactions", handleHistoryTransactions)
	http.HandleFunc("/history_orders", handleHistoryOrders)
	http.HandleFunc("/chart_sampling", handleChartSampling)

	// --- Company / F10 ---
	http.HandleFunc("/xdxr", handleXdxr)
	http.HandleFunc("/company_categories", handleCompanyCategories)
	http.HandleFunc("/company_content", handleCompanyContent)
	http.HandleFunc("/company_info", handleCompanyInfo)

	// --- Block (板块) ---
	http.HandleFunc("/block", handleBlock)

	// --- Index ---
	http.HandleFunc("/index_info", handleIndexInfo)
	http.HandleFunc("/index_momentum", handleIndexMomentum)

	// --- ExQuote ---
	http.HandleFunc("/ex/categories", handleExCategories)
	http.HandleFunc("/ex/list", handleExList)
	http.HandleFunc("/ex/list_extra", handleExListExtra)
	http.HandleFunc("/ex/count", handleExCount)
	http.HandleFunc("/ex/quote", handleExQuote)
	http.HandleFunc("/ex/quotes", handleExQuotes)
	http.HandleFunc("/ex/kline", handleExKline)
	http.HandleFunc("/ex/kline2", handleExKline2)
	http.HandleFunc("/ex/quotes_list", handleExQuotesList)
	http.HandleFunc("/ex/history_transaction", handleExHistoryTransaction)
	http.HandleFunc("/ex/tick_chart", handleExTickChart)
	http.HandleFunc("/ex/history_tick_chart", handleExHistoryTickChart)
	http.HandleFunc("/ex/chart_sampling", handleExChartSampling)
	http.HandleFunc("/ex/board_list", handleExBoardList)
	http.HandleFunc("/ex/table", handleExTable)
	http.HandleFunc("/ex/server_info", handleExServerInfo)

	// --- MAC (板块) ---
	http.HandleFunc("/mac/board_count", handleMACBoardCount)
	http.HandleFunc("/mac/board_list", handleMACBoardList)
	http.HandleFunc("/mac/board_members", handleMACBoardMembers)
	http.HandleFunc("/mac/board_members_quotes", handleMACBoardMembersQuotes)
	http.HandleFunc("/mac/symbol_belong_board", handleMACSymbolBelongBoard)
	http.HandleFunc("/mac/quotes", handleMACQuotes)
	http.HandleFunc("/mac/bars", handleMACBars)

	// --- Backward compat aliases ---
	http.HandleFunc("/api/tick_chart", handleTickChart)
	http.HandleFunc("/api/transactions", handleTransactions)
	http.HandleFunc("/api/xdxr", handleXdxr)
	http.HandleFunc("/api/unusual", handleUnusual)
	http.HandleFunc("/api/index_bars", handleIndexBars)
	http.HandleFunc("/api/index_info", handleIndexInfo)
	http.HandleFunc("/api/index_momentum", handleIndexMomentum)
	http.HandleFunc("/api/stock_list", handleStockList)
	http.HandleFunc("/api/ex/categories", handleExCategories)
	http.HandleFunc("/api/ex/list", handleExList)
	http.HandleFunc("/api/ex/quote", handleExQuote)
	http.HandleFunc("/api/ex/kline", handleExKline)

	go initializeStandardClient()
	go initializeExClient()
	go initializeMACClient()

	log.Printf("gotdx server listening on :%s (std target: %s, ex target: %s)", port, host, exHost)
	log.Fatal(http.ListenAndServe(":"+port, rateLimitMiddleware(http.DefaultServeMux)))
}

// --- Helpers ---

func loadServerAddresses(envName string, fileName string, fallback []string) []string {
	if raw := strings.TrimSpace(os.Getenv(envName)); raw != "" {
		return splitAddressList(raw)
	}
	for _, path := range serverListCandidates(fileName) {
		addresses, err := readServerList(path)
		if err == nil && len(addresses) > 0 {
			log.Printf("loaded %d TDX servers from %s", len(addresses), path)
			return addresses
		}
	}
	return fallback
}

func serverListCandidates(fileName string) []string {
	wd, _ := os.Getwd()
	exe, _ := os.Executable()
	exeDir := filepath.Dir(exe)
	return []string{
		filepath.Join(wd, "..", "..", "assets", "bundle", fileName),
		filepath.Join(wd, "assets", "bundle", fileName),
		filepath.Join(wd, "bundle", fileName),
		filepath.Join(exeDir, "..", "..", "assets", "bundle", fileName),
		filepath.Join(exeDir, "assets", "bundle", fileName),
		filepath.Join(exeDir, "bundle", fileName),
	}
}

func readServerList(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var entries []tdxServerEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, err
	}
	addresses := make([]string, 0, len(entries))
	seen := map[string]struct{}{}
	for _, entry := range entries {
		host := strings.TrimSpace(entry.Host)
		if host == "" || entry.Port <= 0 {
			continue
		}
		address := fmt.Sprintf("%s:%d", host, entry.Port)
		if _, ok := seen[address]; ok {
			continue
		}
		seen[address] = struct{}{}
		addresses = append(addresses, address)
	}
	return addresses, nil
}

func splitAddressList(raw string) []string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\t' || r == ' '
	})
	addresses := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		address := strings.TrimSpace(part)
		if address == "" {
			continue
		}
		if _, ok := seen[address]; ok {
			continue
		}
		seen[address] = struct{}{}
		addresses = append(addresses, address)
	}
	return addresses
}

func primaryAndPool(addresses []string) (string, []string) {
	if len(addresses) == 0 {
		return "", nil
	}
	if len(addresses) == 1 {
		return addresses[0], nil
	}
	return addresses[0], append([]string(nil), addresses[1:]...)
}

func withoutAddress(addresses []string, address string) []string {
	pool := make([]string, 0, len(addresses))
	for _, item := range addresses {
		if item == "" || item == address {
			continue
		}
		pool = append(pool, item)
	}
	return pool
}

func selectedAddress(c *gotdx.Client, fallback string) string {
	if c == nil {
		return fallback
	}
	if current := c.CurrentAddress(); current != "" {
		return current
	}
	return fallback
}

func jsonResp(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func errResp(w http.ResponseWriter, code int, msg string) {
	if code >= 500 {
		recoverProviderAfterError(msg)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func newStandardClient() *gotdx.Client {
	return gotdx.New(
		gotdx.WithTCPAddress(configuredMainHost),
		gotdx.WithTCPAddressPool(configuredMainPool...),
		gotdx.WithTimeoutSec(10),
		gotdx.WithAutoSelectFastest(true),
	)
}

func newExClient() *gotdx.Client {
	return gotdx.NewEx(
		gotdx.WithExTCPAddress(configuredExHost),
		gotdx.WithExTCPAddressPool(configuredExPool...),
		gotdx.WithTimeoutSec(10),
		gotdx.WithAutoSelectFastest(true),
	)
}

func newMacClient() *gotdx.Client {
	return gotdx.NewMAC(
		gotdx.WithTimeoutSec(10),
		gotdx.WithAutoSelectFastest(true),
	)
}

func initializeStandardClient() {
	next := newStandardClient()
	if _, err := next.Connect(); err != nil {
		log.Printf("TDX connect failed: %v (standard endpoints will return errors until reconnect)", err)
		return
	}
	recoveryMu.Lock()
	client = next
	recoveryMu.Unlock()
	log.Printf("TDX connected: %s", selectedAddress(client, configuredMainHost))
}

func initializeExClient() {
	next := newExClient()
	if _, err := next.ConnectEx(); err != nil {
		log.Printf("ExQuote connect failed: %v (ex endpoints will return errors until reconnect)", err)
		return
	}
	recoveryMu.Lock()
	exClient = next
	recoveryMu.Unlock()
	log.Printf("ExQuote connected: %s", selectedAddress(exClient, configuredExHost))
}

func initializeMACClient() {
	next := newMacClient()
	if err := next.ConnectMAC(); err != nil {
		log.Printf("MAC connect failed: %v (mac endpoints will return errors until reconnect)", err)
		return
	}
	recoveryMu.Lock()
	macClient = next
	recoveryMu.Unlock()
	log.Printf("MAC connected: %s", selectedAddress(macClient, ""))
}

func recoverProviderAfterError(msg string) {
	switch {
	case strings.HasPrefix(msg, "TDX error:"):
		reconnectStandard()
	case strings.HasPrefix(msg, "Ex error:"):
		reconnectEx()
	case strings.HasPrefix(msg, "MAC error:"):
		reconnectMAC()
	}
}

func reconnectStandard() {
	recoveryMu.Lock()
	defer recoveryMu.Unlock()
	if client != nil {
		_ = client.Disconnect()
	}
	next := newStandardClient()
	if _, err := next.Connect(); err != nil {
		log.Printf("TDX reconnect failed: %v", err)
		client = nil
		return
	}
	client = next
	log.Printf("TDX reconnected: %s", selectedAddress(client, configuredMainHost))
}

func reconnectEx() {
	recoveryMu.Lock()
	defer recoveryMu.Unlock()
	if exClient != nil {
		_ = exClient.Disconnect()
	}
	next := newExClient()
	if _, err := next.ConnectEx(); err != nil {
		log.Printf("ExQuote reconnect failed: %v", err)
		exClient = nil
		return
	}
	exClient = next
	log.Printf("ExQuote reconnected: %s", selectedAddress(exClient, configuredExHost))
}

func reconnectMAC() {
	recoveryMu.Lock()
	defer recoveryMu.Unlock()
	if macClient != nil {
		_ = macClient.Disconnect()
	}
	next := newMacClient()
	if err := next.ConnectMAC(); err != nil {
		log.Printf("MAC reconnect failed: %v", err)
		macClient = nil
		return
	}
	macClient = next
	log.Printf("MAC reconnected: %s", selectedAddress(macClient, ""))
}

// rateLimitMiddleware serializes TDX requests to protect the single TCP connection
func rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Printf("panic handling %s: %v", r.URL.Path, recovered)
				errResp(w, 500, fmt.Sprintf("TDX parser panic: %v", recovered))
			}
		}()
		path := r.URL.Path
		// Skip rate limiting for meta endpoints
		if path == "/health" || path == "/help" || path == "/rate_limit/status" {
			next.ServeHTTP(w, r)
			return
		}
		// Choose limiter based on path
		if strings.HasPrefix(path, "/ex/") || strings.HasPrefix(path, "/api/ex/") {
			exLimiter.wait()
		} else if strings.HasPrefix(path, "/mac/") {
			macLimiter.wait()
		} else {
			stdLimiter.wait()
		}
		next.ServeHTTP(w, r)
	})
}

// stdCall wraps a TDX standard client call with rate limiting
func stdCall(w http.ResponseWriter, fn func() (interface{}, error)) {
	stdLimiter.wait()
	result, err := fn()
	if err != nil {
		stdLimiter.onError()
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	stdLimiter.onSuccess()
	jsonResp(w, result)
}

// exCall wraps a TDX exquote client call with rate limiting
func exCall(w http.ResponseWriter, fn func() (interface{}, error)) {
	exLimiter.wait()
	result, err := fn()
	if err != nil {
		exLimiter.onError()
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	exLimiter.onSuccess()
	jsonResp(w, result)
}

func parseMarket(code string) uint8 {
	if len(code) > 0 && code[0] == '6' {
		return 1
	}
	return 0
}

func queryInt(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func queryUint8(r *http.Request, key string, def uint8) uint8 {
	return uint8(queryInt(r, key, int(def)))
}

func queryUint16(r *http.Request, key string, def uint16) uint16 {
	return uint16(queryInt(r, key, int(def)))
}

func queryUint32(r *http.Request, key string, def uint32) uint32 {
	return uint32(queryInt(r, key, int(def)))
}

func queryLimitedUint16(w http.ResponseWriter, r *http.Request, key string, def uint16, max uint16) (uint16, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		if def > max {
			errResp(w, 400, fmt.Sprintf("%s default exceeds safe TDX parser limit: got %d, max %d", key, def, max))
			return 0, false
		}
		return def, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		errResp(w, 400, fmt.Sprintf("%s must be a non-negative integer", key))
		return 0, false
	}
	if n > int(max) {
		errResp(w, 400, fmt.Sprintf("%s exceeds safe TDX parser limit: got %d, max %d", key, n, max))
		return 0, false
	}
	return uint16(n), true
}

func queryBool(r *http.Request, key string) bool {
	v := strings.ToLower(r.URL.Query().Get(key))
	return v == "true" || v == "1" || v == "yes"
}

func requireCode(r *http.Request) (string, uint8, bool) {
	code := r.URL.Query().Get("code")
	if code == "" {
		return "", 0, false
	}
	market := parseMarket(code)
	if r.URL.Query().Get("market") != "" {
		market = queryUint8(r, "market", market)
	}
	return code, market, true
}

// --- Health ---

func handleHealth(w http.ResponseWriter, r *http.Request) {
	stdStatus := "ok"
	if client == nil {
		stdStatus = "disconnected"
	}
	exStatus := "ok"
	if exClient == nil {
		exStatus = "disconnected"
	}
	macStatus := "ok"
	if macClient == nil {
		macStatus = "disconnected"
	}
	jsonResp(w, map[string]interface{}{
		"status":    stdStatus,
		"exStatus":  exStatus,
		"macStatus": macStatus,
		"service":   "gotdx",
		"selected": map[string]string{
			"standard": selectedAddress(client, ""),
			"exquote":  selectedAddress(exClient, ""),
			"mac":      selectedAddress(macClient, ""),
		},
		"endpoints": map[string]int{
			"standard": 20,
			"exquote":  15,
			"mac":      7,
		},
	})
}

func handleRateLimitStatus(w http.ResponseWriter, r *http.Request) {
	jsonResp(w, map[string]interface{}{
		"standard": stdLimiter.status(),
		"exquote":  exLimiter.status(),
		"mac":      macLimiter.status(),
	})
}

func handleHelp(w http.ResponseWriter, r *http.Request) {
	help := map[string]interface{}{
		"service": "gotdx — TDX (通达信) market data sidecar",
		"endpoints": map[string]interface{}{
			"quote": map[string]string{
				"params": "code (required)", "desc": "实时行情 (单只)"},
			"quotes": map[string]string{
				"params": "codes (comma-separated)", "desc": "批量实时行情"},
			"kline": map[string]string{
				"params": "code, category?(9=日/5=5分/1=1分/102=周/103=月), count?(100), start?(0)", "desc": "K线数据"},
			"kline_advanced": map[string]string{
				"params": "code, category, start, count, times, adjust", "desc": "高级K线（含复权参数）"},
			"index_bars": map[string]string{
				"params": "code, category?(9), start?(0), count?(100)", "desc": "指数K线"},
			"count": map[string]string{
				"params": "market?(0=深/1=沪)", "desc": "证券数量"},
			"finance": map[string]string{
				"params": "code", "desc": "财务数据 (35项: EPS/总资产/净利润等)"},
			"stock_list": map[string]string{
				"params": "market?(0), start?(0)", "desc": "证券列表"},
			"stock_list_range": map[string]string{
				"params": "market?(0), start?(0), count?(100)", "desc": "分页证券列表"},
			"volume_profile": map[string]string{
				"params": "code", "desc": "筹码分布 (成本分析)"},
			"quotes_list": map[string]string{
				"params": "category?(0), start?(0), count?(80), sort_type?(0), reverse?(false), filter?(0)", "desc": "行情排名"},
			"top_board": map[string]string{
				"params": "category?(0), size?(10)", "desc": "龙虎榜"},
			"unusual": map[string]string{
				"params": "market?(0), start?(0), count?(50)", "desc": "盘口异动"},
			"auction": map[string]string{
				"params": "code, start?(0), count?(50)", "desc": "集合竞价数据"},
			"tick_chart": map[string]string{
				"params": "code", "desc": "当日分时图 (240点)"},
			"history_tick_chart": map[string]string{
				"params": "code, date (YYYYMMDD)", "desc": "历史分时图"},
			"transactions": map[string]string{
				"params": "code, start?(0), count?(100)", "desc": "逐笔成交"},
			"history_transactions": map[string]string{
				"params": "code, date (YYYYMMDD), start?(0), count?(100)", "desc": "历史逐笔成交"},
			"history_orders": map[string]string{
				"params": "code, date (YYYYMMDD)", "desc": "历史委托"},
			"chart_sampling": map[string]string{
				"params": "code", "desc": "图表采样"},
			"xdxr": map[string]string{
				"params": "code", "desc": "除权除息信息 (14种事件)"},
			"company_categories": map[string]string{
				"params": "code", "desc": "F10分类列表"},
			"company_content": map[string]string{
				"params": "code, filename, start?(0), length?(10000)", "desc": "F10内容"},
			"company_info": map[string]string{
				"params": "code", "desc": "F10公司资料完整"},
			"block": map[string]string{
				"params": "filename?(block_zs.dat)", "desc": "板块分类文件"},
			"index_info": map[string]string{
				"params": "code", "desc": "指数信息"},
			"index_momentum": map[string]string{
				"params": "code", "desc": "指数动量"},
			"ex/categories": map[string]string{
				"params": "(none)", "desc": "扩展行情分类"},
			"ex/list": map[string]string{
				"params": "start?(0), count?(100)", "desc": "扩展证券列表"},
			"ex/quote": map[string]string{
				"params": "code, category?(3)", "desc": "扩展行情 (期货/期权/港股)"},
			"ex/quotes": map[string]string{
				"params": "codes (comma-separated), category?(3)", "desc": "批量扩展行情"},
			"ex/kline": map[string]string{
				"params": "code, category?(3), period?(5), count?(100), start?(0)", "desc": "扩展K线"},
			"ex/kline2": map[string]string{
				"params": "code, category?(3), period?(5), count?(100), start?(0), times?(1)", "desc": "扩展K线v2"},
			"ex/quotes_list": map[string]string{
				"params": "category?(3), start?(0), count?(80), sort_type?(0), reverse?(false)", "desc": "扩展行情排名"},
			"ex/history_transaction": map[string]string{
				"params": "code, category?(3), date (YYYYMMDD)", "desc": "扩展历史成交"},
			"ex/tick_chart": map[string]string{
				"params": "code, category?(3)", "desc": "扩展分时图"},
			"ex/history_tick_chart": map[string]string{
				"params": "code, category?(3), date (YYYYMMDD)", "desc": "扩展历史分时"},
			"ex/chart_sampling": map[string]string{
				"params": "code, category?(3)", "desc": "扩展图表采样"},
			"ex/board_list": map[string]string{
				"params": "board_type?(0), start?(0), page_size?(50)", "desc": "板块列表"},
			"ex/table": map[string]string{
				"params": "detail?(false)", "desc": "协议表"},
			"ex/server_info": map[string]string{
				"params": "(none)", "desc": "扩展服务器信息"},
		},
		"notes": map[string]string{
			"market":         "0=深圳, 1=上海. Auto-detected from code prefix (6=SH, others=SZ)",
			"category_kline": "1=1分钟, 5=5分钟, 15=15分钟, 30=30分钟, 60=60分钟, 9=日线, 102=周线, 103=月线",
			"ex_category":    "3=期货, 5=外汇, 8=全球指数, etc. Use /ex/categories to list all",
		},
	}
	jsonResp(w, help)
}

// ==================== Standard Quote ====================

func handleQuote(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	stdCall(w, func() (interface{}, error) {
		return client.GetSecurityQuotes([]uint8{market}, []string{code})
	})
}

func handleQuotes(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	codes := strings.Split(r.URL.Query().Get("codes"), ",")
	if len(codes) == 0 || codes[0] == "" {
		errResp(w, 400, "codes required (comma-separated)")
		return
	}
	markets := make([]uint8, len(codes))
	for i, c := range codes {
		markets[i] = parseMarket(c)
	}
	reply, err := client.GetSecurityQuotes(markets, codes)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleKline(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	count, ok := queryLimitedUint16(w, r, "count", 100, maxSecurityBarsCount)
	if !ok {
		return
	}
	category := queryUint16(r, "category", 9)
	stdCall(w, func() (interface{}, error) {
		return client.GetSecurityBars(category, market, code, 0, count)
	})
}

func handleKlineAdvanced(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	category := queryUint16(r, "category", 9)
	start := queryUint16(r, "start", 0)
	count, ok := queryLimitedUint16(w, r, "count", 100, maxSecurityBarsCount)
	if !ok {
		return
	}
	times := queryUint16(r, "times", 1)
	adjust := queryUint16(r, "adjust", 0)
	reply, err := client.GetKLine(category, market, code, start, count, times, adjust)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleIndexBars(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, publicCode, ok := requireIndexCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	count, ok := queryLimitedUint16(w, r, "count", 100, maxIndexBarsCount)
	if !ok {
		return
	}
	category := queryUint16(r, "category", 9)
	start := queryUint16(r, "start", 0)
	reply, err := client.GetIndexBars(category, market, code, start, count)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	if err := validateIndexBarsReply(publicCode, reply); err != nil {
		errResp(w, 502, fmt.Sprintf("TDX index_bars validation failed: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleCount(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	market := queryUint8(r, "market", 0)
	reply, err := client.GetSecurityCount(market)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleFinance(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := client.GetFinanceInfo(market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleStockList(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	market := queryUint8(r, "market", 0)
	start := queryUint32(r, "start", 0)
	count := queryUint32(r, "count", 100)
	if count > 1000 {
		errResp(w, 400, "count exceeds safe TDX stock_list limit: max 1000")
		return
	}
	reply, err := client.GetSecurityListRange(market, start, count)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleStockListRange(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	market := queryUint8(r, "market", 0)
	start := queryUint32(r, "start", 0)
	count := queryUint32(r, "count", 100)
	reply, err := client.GetSecurityListRange(market, start, count)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleVolumeProfile(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := client.GetVolumeProfile(market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleQuotesList(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	category := queryUint8(r, "category", 0)
	start := queryUint16(r, "start", 0)
	count := queryUint16(r, "count", 80)
	sortType := queryUint16(r, "sort_type", 0)
	reverse := queryBool(r, "reverse")
	filter := queryUint16(r, "filter", 0)
	reply, err := client.GetQuotesList(category, start, count, sortType, reverse, filter)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleTopBoard(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	category := queryUint8(r, "category", 0)
	size := queryUint8(r, "size", 10)
	reply, err := client.GetTopBoard(category, size)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleUnusual(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	market := queryUint8(r, "market", 0)
	start := queryUint32(r, "start", 0)
	count := queryUint32(r, "count", 50)
	reply, err := client.GetUnusual(market, start, count)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleAuction(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	start := queryUint32(r, "start", 0)
	count := queryUint32(r, "count", 50)
	reply, err := client.GetAuction(market, code, start, count)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

// ==================== Tick / Transaction ====================

func handleTickChart(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := client.GetMinuteTimeData(market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleHistoryTickChart(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	date := queryUint32(r, "date", 0)
	if date == 0 {
		errResp(w, 400, "date required (YYYYMMDD)")
		return
	}
	reply, err := client.GetHistoryMinuteTimeData(date, market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleTransactions(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	start := queryUint16(r, "start", 0)
	count := queryUint16(r, "count", 100)
	reply, err := client.GetTransactionData(market, code, start, count)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleHistoryTransactions(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	date := queryUint32(r, "date", 0)
	if date == 0 {
		errResp(w, 400, "date required (YYYYMMDD)")
		return
	}
	start := queryUint16(r, "start", 0)
	count := queryUint16(r, "count", 100)
	reply, err := client.GetHistoryTransactionData(date, market, code, start, count)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleHistoryOrders(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	date := queryUint32(r, "date", 0)
	if date == 0 {
		errResp(w, 400, "date required (YYYYMMDD)")
		return
	}
	reply, err := client.GetHistoryOrders(date, market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleChartSampling(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := client.GetChartSampling(market, code)
	if err != nil {
		firstErr := err
		stdLimiter.onError()
		reconnectStandard()
		if client == nil {
			errResp(w, 500, fmt.Sprintf("TDX error: %v", firstErr))
			return
		}
		tickReply, tickErr := client.GetTickChart(market, code, 0, 240)
		if tickErr != nil {
			errResp(w, 500, fmt.Sprintf("TDX error: %v; fallback tick_chart failed: %v", firstErr, tickErr))
			return
		}
		prices := make([]float64, 0, len(tickReply.List))
		for _, item := range tickReply.List {
			prices = append(prices, item.Price)
		}
		stdLimiter.onSuccess()
		jsonResp(w, map[string]interface{}{
			"Count":          len(prices),
			"Prices":         prices,
			"FallbackFrom":   "tick_chart",
			"FallbackReason": firstErr.Error(),
		})
		return
	}
	stdLimiter.onSuccess()
	jsonResp(w, reply)
}

// ==================== Company / F10 ====================

func handleXdxr(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := client.GetXDXRInfo(market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleCompanyCategories(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := client.GetCompanyCategories(market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleCompanyContent(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	filename := r.URL.Query().Get("filename")
	if filename == "" {
		errResp(w, 400, "filename required")
		return
	}
	start := queryUint32(r, "start", 0)
	length := queryUint32(r, "length", 10000)
	reply, err := client.GetCompanyContent(market, code, filename, start, length)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleCompanyInfo(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := client.GetCompanyInfo(market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

// ==================== Block (板块) ====================

func handleBlock(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	filename := r.URL.Query().Get("filename")
	if filename == "" {
		filename = "block_zs.dat"
	}
	reply, err := client.GetParsedBlockFile(filename)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	jsonResp(w, reply)
}

// ==================== Index ====================

func handleIndexInfo(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, publicCode, ok := requireIndexCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := client.GetIndexInfo(market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	if err := validateIndexInfoReply(publicCode, reply); err != nil {
		errResp(w, 502, fmt.Sprintf("TDX index_info validation failed: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleIndexMomentum(w http.ResponseWriter, r *http.Request) {
	if client == nil {
		errResp(w, 503, "TDX not connected")
		return
	}
	code, market, publicCode, ok := requireIndexCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := client.GetIndexMomentum(market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("TDX error: %v", err))
		return
	}
	if err := validateIndexMomentumReply(publicCode, reply); err != nil {
		errResp(w, 502, fmt.Sprintf("TDX index_momentum validation failed: %v", err))
		return
	}
	jsonResp(w, reply)
}

// ==================== ExQuote ====================

func handleExServerInfo(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	reply, err := exClient.GetExServerInfo()
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExCount(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	reply, err := exClient.ExGetCount()
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExCategories(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	reply, err := exClient.ExGetCategoryList()
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExList(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	start := queryUint32(r, "start", 0)
	count := queryUint16(r, "count", 100)
	reply, err := exClient.ExGetList(start, count)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExListExtra(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	a := queryUint16(r, "a", 0)
	b := queryUint16(r, "b", 0)
	count := queryUint16(r, "count", 100)
	reply, err := exClient.ExGetListExtra(a, b, count)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExQuote(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	code := r.URL.Query().Get("code")
	category := queryUint8(r, "category", 3)
	reply, err := exClient.ExGetQuote(category, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExQuotes(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	codes := strings.Split(r.URL.Query().Get("codes"), ",")
	if len(codes) == 0 || codes[0] == "" {
		errResp(w, 400, "codes required (comma-separated)")
		return
	}
	categories := make([]uint8, len(codes))
	defaultCat := queryUint8(r, "category", 3)
	for i := range categories {
		categories[i] = defaultCat
	}
	reply, err := exClient.ExGetQuotes(categories, codes)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExKline(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	code := r.URL.Query().Get("code")
	category := queryUint8(r, "category", 3)
	period := queryUint16(r, "period", 5)
	count := queryUint16(r, "count", 100)
	start := queryUint32(r, "start", 0)
	reply, err := exClient.ExGetKLine(category, code, period, start, count, 1)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExKline2(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	code := r.URL.Query().Get("code")
	category := queryUint8(r, "category", 3)
	period := queryUint16(r, "period", 5)
	count := queryUint32(r, "count", 100)
	start := queryUint32(r, "start", 0)
	times := queryUint16(r, "times", 1)
	reply, err := exClient.ExGetKLine2(category, code, period, start, count, times)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExQuotesList(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	category := queryUint8(r, "category", 3)
	start := queryUint16(r, "start", 0)
	count := queryUint16(r, "count", 80)
	sortType := queryUint16(r, "sort_type", 0)
	reverse := queryBool(r, "reverse")
	reply, err := exClient.ExGetQuotesList(category, start, count, sortType, reverse)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExHistoryTransaction(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	code := r.URL.Query().Get("code")
	category := queryUint8(r, "category", 3)
	date := queryUint32(r, "date", 0)
	if date == 0 {
		errResp(w, 400, "date required (YYYYMMDD)")
		return
	}
	reply, err := exClient.ExGetHistoryTransaction(date, category, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExTickChart(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	code := r.URL.Query().Get("code")
	category := queryUint8(r, "category", 3)
	reply, err := exClient.ExGetTickChart(category, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExHistoryTickChart(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	code := r.URL.Query().Get("code")
	category := queryUint8(r, "category", 3)
	date := queryUint32(r, "date", 0)
	if date == 0 {
		errResp(w, 400, "date required (YYYYMMDD)")
		return
	}
	reply, err := exClient.ExGetHistoryTickChart(date, category, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExChartSampling(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	code := r.URL.Query().Get("code")
	category := queryUint8(r, "category", 3)
	reply, err := exClient.ExGetChartSampling(category, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleExBoardList(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	boardType := queryUint16(r, "board_type", 0)
	start := queryUint16(r, "start", 0)
	pageSize := queryUint16(r, "page_size", 50)
	reply, err := exClient.ExGetBoardList(boardType, start, pageSize)
	if err != nil {
		firstErr := err
		exLimiter.onError()
		reconnectEx()
		if macClient == nil {
			reconnectMAC()
		}
		if macClient == nil {
			errResp(w, 500, fmt.Sprintf("Ex error: %v", firstErr))
			return
		}
		macReply, macErr := macClient.GetMACBoardList(boardType, start, pageSize)
		if macErr != nil {
			macLimiter.onError()
			reconnectMAC()
			if macClient != nil {
				macReply, macErr = macClient.GetMACBoardList(boardType, start, pageSize)
			}
		}
		if macErr != nil {
			errResp(w, 500, fmt.Sprintf("Ex error: %v; fallback mac/board_list failed: %v", firstErr, macErr))
			return
		}
		exLimiter.onSuccess()
		macLimiter.onSuccess()
		jsonResp(w, map[string]interface{}{
			"CountAll":       macReply.CountAll,
			"Total":          macReply.Total,
			"Count":          macReply.Count,
			"List":           macReply.List,
			"FallbackFrom":   "mac/board_list",
			"FallbackReason": firstErr.Error(),
		})
		return
	}
	exLimiter.onSuccess()
	jsonResp(w, reply)
}

func handleExTable(w http.ResponseWriter, r *http.Request) {
	if exClient == nil {
		errResp(w, 503, "ExQuote not connected")
		return
	}
	detail := queryBool(r, "detail")
	var result string
	var err error
	if detail {
		result, err = exClient.ExGetTableDetail()
	} else {
		result, err = exClient.ExGetTable()
	}
	if err != nil {
		errResp(w, 500, fmt.Sprintf("Ex error: %v", err))
		return
	}
	jsonResp(w, map[string]string{"data": result})
}

// ==================== MAC (板块成员/行情/归属) ====================

func handleMACBoardCount(w http.ResponseWriter, r *http.Request) {
	if macClient == nil {
		errResp(w, 503, "MAC not connected")
		return
	}
	boardType := queryUint16(r, "board_type", 0)
	reply, err := macClient.GetMACBoardCount(boardType)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("MAC error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleMACBoardList(w http.ResponseWriter, r *http.Request) {
	if macClient == nil {
		errResp(w, 503, "MAC not connected")
		return
	}
	boardType := queryUint16(r, "board_type", 0)
	start := queryUint16(r, "start", 0)
	pageSize := queryUint16(r, "page_size", 50)
	reply, err := macClient.GetMACBoardList(boardType, start, pageSize)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("MAC error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleMACBoardMembers(w http.ResponseWriter, r *http.Request) {
	if macClient == nil {
		errResp(w, 503, "MAC not connected")
		return
	}
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		errResp(w, 400, "symbol required (board symbol)")
		return
	}
	sortType := queryUint16(r, "sort_type", 0)
	start := queryUint32(r, "start", 0)
	pageSize := queryUint8(r, "page_size", 50)
	sortOrder := queryUint16(r, "sort_order", 0)
	reply, err := macClient.GetMACBoardMembers(symbol, sortType, start, pageSize, sortOrder)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("MAC error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleMACBoardMembersQuotes(w http.ResponseWriter, r *http.Request) {
	if macClient == nil {
		errResp(w, 503, "MAC not connected")
		return
	}
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		errResp(w, 400, "symbol required (board symbol)")
		return
	}
	sortType := queryUint16(r, "sort_type", 0)
	start := queryUint32(r, "start", 0)
	pageSize := queryUint8(r, "page_size", 50)
	sortOrder := queryUint8(r, "sort_order", 0)
	reply, err := macClient.GetMACBoardMembersQuotes(symbol, sortType, start, pageSize, sortOrder)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("MAC error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleMACSymbolBelongBoard(w http.ResponseWriter, r *http.Request) {
	if macClient == nil {
		errResp(w, 503, "MAC not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := macClient.GetMACSymbolBelongBoard(market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("MAC error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleMACQuotes(w http.ResponseWriter, r *http.Request) {
	if macClient == nil {
		errResp(w, 503, "MAC not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	reply, err := macClient.GetMACQuotes(market, code)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("MAC error: %v", err))
		return
	}
	jsonResp(w, reply)
}

func handleMACBars(w http.ResponseWriter, r *http.Request) {
	if macClient == nil {
		errResp(w, 503, "MAC not connected")
		return
	}
	code, market, ok := requireCode(r)
	if !ok {
		errResp(w, 400, "code required")
		return
	}
	period := queryUint16(r, "period", 9)
	times := queryUint16(r, "times", 1)
	start := queryUint32(r, "start", 0)
	count := queryUint16(r, "count", 100)
	adjust := queryUint16(r, "adjust", 0)
	reply, err := macClient.GetMACSymbolBars(market, code, period, times, start, count, adjust)
	if err != nil {
		errResp(w, 500, fmt.Sprintf("MAC error: %v", err))
		return
	}
	jsonResp(w, reply)
}
