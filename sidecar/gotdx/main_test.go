package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestReadServerListDeduplicatesHostPortRows(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tdx_servers.json")
	if err := os.WriteFile(path, []byte(`[
		{"host":"110.41.147.114","port":7709,"name":"a"},
		{"host":"110.41.147.114","port":7709,"name":"duplicate"},
		{"host":"112.74.214.43","port":7727,"name":"ex"},
		{"host":"","port":7709,"name":"bad"},
		{"host":"127.0.0.1","port":0,"name":"bad"}
	]`), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	got, err := readServerList(path)
	if err != nil {
		t.Fatalf("readServerList failed: %v", err)
	}
	want := []string{"110.41.147.114:7709", "112.74.214.43:7727"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected addresses: got %#v want %#v", got, want)
	}
}

func TestPrimaryAndPoolKeepsFallbackPool(t *testing.T) {
	primary, pool := primaryAndPool([]string{"a:1", "b:2", "c:3"})

	if primary != "a:1" {
		t.Fatalf("unexpected primary: %q", primary)
	}
	if !reflect.DeepEqual(pool, []string{"b:2", "c:3"}) {
		t.Fatalf("unexpected pool: %#v", pool)
	}
}

func TestWithoutAddressPreservesOtherServers(t *testing.T) {
	got := withoutAddress([]string{"a:1", "b:2", "c:3"}, "b:2")
	want := []string{"a:1", "c:3"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected pool: got %#v want %#v", got, want)
	}
}
