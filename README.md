# SPAM PDAM - Sistem Monitoring Debit Air & Hidrolika Jaringan Pipa (SCADA)

Aplikasi Web GIS & Engine Hidrolika Realtime untuk monitoring aliran debit air, tinggi tekan (*Hydraulic Grade Line*), kontinuitas aliran, dan pemodelan Hazen-Williams (Standar EPANET 2.2 Metric) pada 9 wilayah jaringan pipa distribusi SPAM PDAM Kabupaten Subang, terintegrasi dengan **Supabase Cloud Server** secara *real-time*.

![PDAM SCADA](https://img.shields.io/badge/PDAM-SPAM%20Monitoring-0284c7?style=for-the-badge&logo=water)
![Supabase Realtime](https://img.shields.io/badge/Supabase-Realtime%20Cloud-3ecf8e?style=for-the-badge&logo=supabase)
![EPANET Hazen Williams](https://img.shields.io/badge/EPANET-Hazen--Williams-10b981?style=for-the-badge)
![Mobile Friendly](https://img.shields.io/badge/UI%2FUX-Mobile%20Optimized-8b5cf6?style=for-the-badge)

---

## 🚀 Fitur Utama

1. **Multi-Wilayah Terpadu (9 Wilayah SPAM Kabupaten Subang)**:
   - Akses instan ke 9 wilayah jaringan pipa distribusi PDAM melalui dropdown pemilih wilayah:
     - 📍 **SPAM Bunihayu** (17 Simpul • 16 Pipa)
     - 📍 **SPAM Cisalak** (203 Simpul • 202 Pipa)
     - 📍 **SPAM Jalancagak / Ciseuti** (35 Simpul • 33 Pipa)
     - 📍 **SPAM Kasomalang** (91 Simpul • 90 Pipa)
     - 📍 **SPAM Pabuaran** (290 Simpul • 290 Pipa)
     - 📍 **SPAM Sagalaherang** (211 Simpul • 217 Pipa • Aliran Gravitasi)
     - 📍 **SPAM Subang Kota** (314 Simpul • 321 Pipa)
     - 📍 **SPAM Tambakan** (13 Simpul • 11 Pipa)
     - 📍 **SPAM Tanjungsiang** (272 Simpul • 279 Pipa • Aliran Gravitasi)
   - Peta GIS otomatis bergeser dan memperbesar (*auto fit bounds*) ke wilayah yang dipilih.

2. **Integrasi Cloud Supabase & Sinkronisasi Real-Time**:
   - **Tersambung ke Server SCADA**: Terhubung ke database Supabase tabel `scada_telemetry`.
   - **Two-Way Sync**:
     - Pengukuran tekanan lapangan (manometer) ditarik otomatis dari server Supabase saat wilayah dibuka.
     - Setiap ada input tekanan baru oleh petugas di lapangan, data otomatis tersimpan (*upsert*) ke Supabase dan disiarkan secara *live* ke pengguna lain melalui Supabase Realtime WebSocket.
   - **Pencadangan Topologi Jaringan**: Fitur pencadangan konfigurasi jaringan pipa langsung ke server Supabase Cloud.
   - **Hybrid Offline**: Tetap dapat beroperasi lancar dengan penyimpanan lokal (*LocalStorage*) saat petugas berada di area minim sinyal.

3. **Peta Jaringan GIS Interaktif (Leaflet)**:
   - Visualisasi topologi pipa, reservoir, junction, dan pompa air.
   - Pilihan peta satelit (*Google Hybrid, Google Satellite, OSM, Carto Light/Dark*).
   - Tampilan angka debit langsung pada setiap ruas pipa (`💧 10.0 L/s` atau `m³/h`).
   - Panah denyut penunjuk arah aliran (*flow direction pulse animation*).
   - Indikator warna status kecepatan hidrolika (Ideal, Rendah, Waspada, Kritis).

4. **Dual Mode Pengoperasian**:
   - **Mode Input Demand (EPANET)**: Menghitung distribusi debit, kehilangan tinggi tekan (*head loss*), dan tekanan tiap junction secara otomatis.
   - **Mode Tekanan Lapangan (Manometer)**: Input tekanan riil terukur manometer di lapangan untuk menganalisis beda tekan dan debit aliran.

5. **Pengaturan Sumber Air Fleksibel**:
   - **Sistem Pemompaan (Pumped)**: Pengaturan head pompa ($H_{pompa}$ dalam meter) dan kapasitas debit pompa ($Q_{pompa}$ dalam L/s atau m³/jam) beserta status aktif/mati.
   - **Sistem Gravitasi (Gravity)**: Pengaturan debit suplai reservoir ($Q_{res}$) dan elevasi muka air ($z_{res}$) memanfaatkan beda tinggi alami topografi.

6. **Skema Alur Berurutan (Hulu ke Hilir)**:
   - Tab khusus yang menyajikan urutan aliran air secara berkesinambungan dari Reservoir & Pompa Hulu &rarr; Jalur Transmisi &rarr; Percabangan & Loop &rarr; Titik Distribusi Terjauh.

7. **Diagram Profil Hidrolis (Hydraulic Grade Line / HGL)**:
   - Visualisasi grafik elevasi tanah vs tinggi tekan total energi sepanjang jalur utama pipa menggunakan Chart.js.

8. **Desain Ramah Smartphone (Mobile Phone UI/UX)**:
   - **Mobile Bottom Navigation Bar**: Pindah antar tab dengan jempol satu tangan.
   - **Collapsible Bottom Sheet**: Panel input lapangan dapat disembunyikan agar peta terlihat 100% penuh di layar ponsel.
   - **Pencegahan Auto-Zoom**: Kolom input form dioptimasi agar tidak memicu zoom liar di browser HP.

9. **Laporan & Ekspor Data**:
   - Ekspor data hasil analisa hidrolika ke format **CSV / Excel**.
   - Format cetak ramah kertas (*print media optimized*) untuk laporan dinas/teknik resmi.

---

## 🛠️ Struktur Proyek

```
monitoring-debit/
├── index.html              # Antarmuka web utama responsif & mobile-friendly
├── run_app.py              # Script python lokal webserver
├── start_app.bat           # Launcher one-click untuk Windows
├── css/
│   └── style.css           # Styling kustom, tema responsif & animasi denyut aliran
├── js/
│   ├── app.js              # Orkestrasi state multi-wilayah & inisialisasi aplikasi
│   ├── chart_controller.js # Pengelola grafik Chart.js Profil HGL
│   ├── config.js           # Konfigurasi wilayah, kredensial Supabase & gaya peta
│   ├── hydraulic_engine.js # Engine Hazen-Williams EPANET 2.2
│   ├── map_manager.js      # Pengelola peta Leaflet GIS & visualisasi pipa
│   ├── supabase_client.js  # Klien Supabase REST & Realtime WebSocket
│   └── ui_controller.js    # Manajemen DOM, modal, toast, dan event interaksi
└── [Data EPANET Wilayah]:
    ├── epanet_bunihayu.json     # SPAM Bunihayu (17 simpul, 16 pipa)
    ├── epanet_cisalak.json      # SPAM Cisalak (203 simpul, 202 pipa)
    ├── epanet_jalancagak.json   # SPAM Jalancagak (35 simpul, 33 pipa)
    ├── epanet_kasomalang.json   # SPAM Kasomalang (91 simpul, 90 pipa)
    ├── epanet_pabuaran.json     # SPAM Pabuaran (290 simpul, 290 pipa)
    ├── epanet_sagalaherang.json # SPAM Sagalaherang (211 simpul, 217 pipa)
    ├── epanet_subang.json       # SPAM Subang Kota (314 simpul, 321 pipa)
    ├── epanet_tambakan.json     # SPAM Tambakan (13 simpul, 11 pipa)
    └── epanet_tanjungsiang.json # SPAM Tanjungsiang (272 simpul, 279 pipa)
```

---

## 💻 Cara Menjalankan

### Opsi 1: Klik Ganda (Windows)
Cukup klik ganda file `start_app.bat`. Browser akan terbuka otomatis di `http://localhost:8000`.

### Opsi 2: Menggunakan Python
```bash
python run_app.py
```

### Opsi 3: Buka Langsung di Browser
Buka file `index.html` langsung di browser Chrome, Firefox, Edge, atau peramban smartphone.

---

## ☁️ Konfigurasi Supabase
Koneksi Supabase telah terkonfigurasi di file `js/config.js`:
- **Project URL**: `https://nbjfxzulzxxujudntdab.supabase.co`
- **Tabel Telemetry**: `scada_telemetry`
- **Realtime**: Aktif secara otomatis via WebSocket.

---

## 📜 Lisensi & Pengembang
Dikembangkan untuk kebutuhan monitoring, simulasi hidrolika, dan operasional teknik distribusi air bersih SPAM PDAM Kabupaten Subang.
