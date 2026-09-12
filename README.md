# 💧 Prodist Scada (Mobile-First Web App)

Sistem Informasi Prodist Scada Monitoring Jaringan Pipa Air Bersih berbasis web mandiri (*standalone web*), ramah ponsel pintar (*mobile-first*), dan siap dijalankan langsung melalui **GitHub Pages**.

🌐 **Akses Aplikasi (Live Demo)**:  
👉 **[https://rikoa7x-art.github.io/scada/](https://rikoa7x-art.github.io/scada/)**

---

## 📱 Fitur Utama

- **🚀 Ringan & Tanpa Server (< 500 KB)**: Berjalan 100% di browser HP/komputer tanpa perlu backend Node.js.
- **⚡ Inversi Hidrolika Hazen-Williams (PVC $C=140$)**: Cukup masukkan nilai tekanan manometer di lapangan, debit aliran pipa ($Q$) dalam liter/detik dan $\text{m}^3/\text{jam}$ serta kecepatan ($v$) langsung terhitung otomatis tanpa perlu menebak *demand* per simpul!
- **📍 GPS Penemu Simpul Terdekat**: Membaca sensor GPS ponsel petugas untuk langsung menemukan titik pipa PDAM terdekat di lapangan lengkap dengan jarak meter dan tombol ukur instan.
- **⭐ 45 Titik Pantau Strategis (6 Zona Pelayanan)**: Terbagi proporsional meliputi Pasirkareumbi, Subang Kota, Sukamelang & Cidahu, Soklat & Wanareja, Dangdeur & Sukasari, serta Cinangsi & Cibogo.
- **📲 PWA (Progressive Web App)**: Bisa langsung dipasang ke Layar Utama (*Add to Home Screen*) di smartphone Android dan iOS.
- **💾 Penyimpanan Mandiri & Sinkronisasi**: Data tersimpan di `localStorage` HP masing-masing petugas, dilengkapi fitur **Cadangkan & Pulihkan (JSON)** untuk bertukar data via WhatsApp/Email.
- **🗺️ Multi-Wilayah (KML/GeoJSON)**: Mendukung impor jalur pipa daerah lain (Ciasem, Pamanukan, dll).

---

## 🛠️ Cara Penggunaan di Komputer (Offline / Server Lokal)

Jika ingin menjalankan server lokal di PC kantor:
1. Jalankan berkas **`start_scada.bat`** (atau `node server.js`).
2. Browser akan otomatis terbuka di `http://localhost:3000`.

---

## 📄 Lisensi & Dokumentasi

- Panduan Deploy GitHub Pages: [`PANDUAN_DEPLOY_GITHUB.md`](./PANDUAN_DEPLOY_GITHUB.md)
- Panduan Operasional SCADA: [`PANDUAN_SCADA_SUBANG.md`](./PANDUAN_SCADA_SUBANG.md)

Dikembangkan untuk optimalisasi monitoring hidrolika jaringan pipa Prodist Scada.
