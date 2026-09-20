# SPAM PDAM - Sistem Monitoring Debit Air & Hidrolika Jaringan Pipa (SCADA)

Aplikasi Web GIS & Engine Hidrolika Realtime untuk monitoring aliran debit air, tinggi tekan (*Hydraulic Grade Line*), kontinuitas aliran, dan pemodelan Hazen-Williams (Standar EPANET 2.2 Metric) pada jaringan pipa distribusi SPAM PDAM Bunihayu.

![PDAM SCADA](https://img.shields.io/badge/PDAM-SPAM%20Monitoring-0284c7?style=for-the-badge&logo=water)
![EPANET Hazen Williams](https://img.shields.io/badge/EPANET-Hazen--Williams-10b981?style=for-the-badge)
![Mobile Friendly](https://img.shields.io/badge/UI%2FUX-Mobile%20Optimized-8b5cf6?style=for-the-badge)

---

## 🚀 Fitur Utama

1. **Peta Jaringan GIS Interaktif (Leaflet)**:
   - Visualisasi topologi pipa, reservoir, junction, dan pompa air.
   - Pilihan peta satelit (*Google Hybrid, Google Satellite, OSM, Carto Light/Dark*).
   - Tampilan angka debit langsung pada setiap ruas pipa (`💧 10.0 L/s`).
   - Panah denyut penunjuk arah aliran (*flow direction pulse animation*).
   - Indikator warna status kecepatan hidrolika (Ideal, Rendah, Waspada, Kritis).

2. **Dual Mode Pengoperasian**:
   - **Mode Input Demand (EPANET)**: Menghitung distribusi debit, kehilangan tinggi tekan (*head loss*), dan tekanan tiap junction secara otomatis.
   - **Mode Tekanan Lapangan (Manometer)**: Input tekanan riil terukur manometer di lapangan untuk menganalisis beda tekan dan debit aliran.

3. **Pengaturan Sumber Air Fleksibel**:
   - **Sistem Pemompaan (Pumped)**: Pengaturan head pompa ($H_{pompa}$ dalam meter) dan kapasitas debit pompa ($Q_{pompa}$ dalam L/s atau m³/jam) beserta estimasi kebutuhan daya pompa ($kW$).
   - **Sistem Gravitasi (Gravity)**: Pengaturan debit suplai reservoir ($Q_{res}$) dan elevasi muka air ($z_{res}$) memanfaatkan beda tinggi alami topografi.

4. **Skema Alur Berurutan (Hulu ke Hilir)**:
   - Tab khusus yang menyajikan urutan aliran air secara berkesinambungan dari Reservoir R4 &rarr; Pompa PMP4 &rarr; Jalur Transmisi &rarr; Percabangan & Loop &rarr; Titik Distribusi Terjauh.

5. **Diagram Profil Hidrolis (Hydraulic Grade Line / HGL)**:
   - Visualisasi grafik elevasi tanah vs tinggi tekan total energi sepanjang jalur utama pipa menggunakan Chart.js.

6. **Desain Ramah Smartphone (Mobile Phone UI/UX)**:
   - **Mobile Bottom Navigation Bar**: Pindah antar tab dengan jempol satu tangan.
   - **Collapsible Bottom Sheet**: Panel input lapangan dapat disembunyikan agar peta terlihat 100% penuh di layar ponsel.
   - **Pencegahan Auto-Zoom**: Kolom input form dioptimasi agar tidak memicu zoom liar di browser HP.

7. **Laporan & Ekspor Data**:
   - Ekspor data hasil analisa hidrolika ke format **CSV / Excel**.
   - Format cetak ramah kertas (*print media optimized*) untuk laporan dinas/teknik resmi.

---

## 🛠️ Struktur Proyek

```
monitoring-debit/
├── index.html              # Antarmuka web utama responsif
├── epanet_bunihayu.json    # Data topologi jaringan pipa SPAM Bunihayu
├── run_app.py              # Script python lokal webserver
├── start_app.bat           # Launcher one-click untuk Windows
├── css/
│   └── style.css           # Styling kustom & animasi aliran
└── js/
    ├── app.js              # Orkestrasi state & inisialisasi aplikasi
    ├── chart_controller.js # Pengelola grafik Chart.js Profil HGL
    ├── config.js           # Konfigurasi konstanta & gaya peta
    ├── hydraulic_engine.js # Engine Hazen-Williams EPANET 2.2
    ├── map_manager.js      # Pengelola peta Leaflet GIS & visualisasi pipa
    └── ui_controller.js    # Manajemen DOM, modal, dan event interaksi
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

## 📜 Lisensi & Pengembang
Dikembangkan untuk kebutuhan monitoring dan operasional teknik distribusi air bersih SPAM PDAM.
