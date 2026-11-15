// Bench desktop launcher: one executable that contains the whole course.
// It serves the embedded site on localhost and opens the default browser.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"runtime"
	"strings"
	"time"
)

//go:embed all:site
var site embed.FS

// A fixed port keeps the browser origin stable, so saved progress is found again on the next run.
const defaultPort = 47800

// Explicit types: Windows takes MIME types from the registry, and a wrong type for .js stops ES modules loading.
var types = map[string]string{
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
	".ico": "image/x-icon", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func alreadyRunning(url string) bool {
	c := http.Client{Timeout: 700 * time.Millisecond}
	r, err := c.Get(url + "bench-ping")
	if err != nil {
		return false
	}
	defer r.Body.Close()
	return r.Header.Get("X-Bench") == "1"
}

func main() {
	port := flag.Int("port", defaultPort, "port to listen on (localhost only)")
	noOpen := flag.Bool("no-browser", false, "do not open the browser automatically")
	flag.Parse()

	root, err := fs.Sub(site, "site")
	if err != nil {
		fmt.Println("embedded site missing:", err)
		os.Exit(1)
	}
	url := fmt.Sprintf("http://localhost:%d/", *port)

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		if alreadyRunning(url) {
			fmt.Println("Bench is already running; opening it at", url)
			if !*noOpen {
				openBrowser(url)
			}
			return
		}
		fmt.Printf("Port %d is in use by another program.\nRun again with a different port, for example:  --port %d\n"+
			"(Progress is stored per address, so keep using the same port.)\n", *port, *port+1)
		if runtime.GOOS == "windows" {
			fmt.Println("\nPress Enter to close.")
			fmt.Scanln()
		}
		os.Exit(1)
	}

	files := http.FileServer(http.FS(root))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Bench", "1")
		if r.URL.Path == "/bench-ping" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if t, ok := types[strings.ToLower(path.Ext(r.URL.Path))]; ok {
			w.Header().Set("Content-Type", t)
		}
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})

	fmt.Println("Bench — embedded systems and hardware security course")
	fmt.Println()
	fmt.Println("  Open in your browser:  ", url)
	fmt.Println("  Stop the course:        close this window (or press Ctrl+C)")
	fmt.Println()
	fmt.Println("Progress, notes and bookmarks are saved in your browser for this address.")
	if !*noOpen {
		go func() { time.Sleep(300 * time.Millisecond); openBrowser(url) }()
	}
	if err := http.Serve(ln, handler); err != nil {
		fmt.Println("server stopped:", err)
		os.Exit(1)
	}
}
