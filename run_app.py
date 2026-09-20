#!/usr/bin/env python3
"""
Launcher Server Lokal untuk Aplikasi Monitoring Debit Air SPAM PDAM
"""

import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8000

def find_available_port(start_port):
    import socket
    port = start_port
    while port < start_port + 100:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', port)) != 0:
                return port
            port += 1
    return start_port

def run():
    # Pastikan working directory adalah folder script berada
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    port = find_available_port(PORT)
    url = f"http://localhost:{port}"

    handler = http.server.SimpleHTTPRequestHandler
    # Izinkan CORS dan caching minimal untuk kenyamanan pengembangan
    handler.extensions_map.update({
        '.json': 'application/json',
        '.js': 'application/javascript',
        '.css': 'text/css',
    })

    print("=" * 65)
    print("   PDAM SPAM - SISTEM MONITORING DEBIT AIR JARINGAN PIPA")
    print("   Metoda Analisa Hidrolika: Hazen-Williams (Standar EPANET)")
    print("=" * 65)
    print(f"[*] Server berjalan di: {url}")
    print("[*] Membuka browser secara otomatis...")
    print("[*] Tekan Ctrl+C di terminal ini untuk menghentikan server.")
    print("=" * 65)

    webbrowser.open(url)

    with socketserver.TCPServer(("", port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[!] Server dimatikan. Sampai jumpa!")
            sys.exit(0)

if __name__ == '__main__':
    run()
