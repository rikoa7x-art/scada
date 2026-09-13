# PANDUAN PENGGUNAAN SISTEM SCADA JARINGAN PIPA PDAM KOTA SUBANG
### Monitoring Telemetri Tekanan Berbasis AI Vision & Perhitungan Debit Hidrolis Real-Time

---

## 1. Ringkasan Sistem
Sistem ini mentransformasi data jaringan pipa air minum Kota Subang (**314 Node**, **321 Pipa**, total panjang **76,84 km**) menjadi sistem pemantauan **SCADA (Supervisory Control and Data Acquisition)** aktif.

Sistem bekerja dengan prinsip:
1. **Penerimaan Foto Lapangan**: Petugas lapangan memfoto manometer (analog atau digital) di titik-titik jaringan pipa Subang.
2. **AI Vision Reader**: AI **Meta Llama-3.2-11B Vision** via NVIDIA NIM membaca angka jarum/display secara otomatis menjadi angka digital (`bar` / `mH2O`).
3. **Pemetaan Spasial GIS**: Tekanan dipasangkan ke titik koordinat / junction di peta Kota Subang.
4. **Kalkulasi Inversi Hidrolik (Hazen-Williams)**: Berdasarkan beda tekanan antara titik-titik terukur, elevasi, diameter pipa, dan panjang pipa riil, sistem menghitung **debit air aktual (\(Q\) dalam L/s dan \(\text{m}^3\)/jam)** serta **kecepatan aliran (\(v\) dalam m/s)** di seluruh jaringan pipa Subang secara otomatis.

---

## 2. Cara Menjalankan Aplikasi
Anda dapat menjalankan sistem melalui 2 cara:

### Cara 1: Menggunakan Launcher Server (Sangat Direkomendasikan)
1. Cukup **klik dua kali (*double-click*)** berkas:
   ```
   start_scada.bat
   ```
2. Browser akan otomatis terbuka dan menampilkan dashboard SCADA di alamat:
   ```
   http://localhost:3000
   ```
3. Petugas lain di kantor yang terhubung ke satu jaringan WiFi/LAN juga bisa mengaksesnya dari komputer atau ponsel mereka dengan membuka `http://<IP_KOMPUTER_SERVER>:3000`.

### Cara 2: Membuka Langsung Berkas HTML (⚠️ Tidak Direkomendasikan)
* **Peringatan**: Cara ini **tidak berfungsi** pada browser modern karena pembatasan keamanan CORS pada protokol `file:///`. Gunakan **Cara 1** (menjalankan server) untuk pengalaman terbaik.

---

## 3. Alur Kerja Input Foto Manometer dari Lapangan

1. **Terima Foto dari Petugas**:
   * Petugas di lapangan mengirimkan foto manometer melalui WhatsApp / Telegram / Google Drive ke operator di kantor control room.
2. **Buka Modal Input di SCADA**:
   * Klik tombol **"📸 Input Foto Manometer"** di toolbar atas.
3. **Pilih Titik Junction**:
   * Pilih titik lokasi pipa yang diukur (contoh: `J307`, `J308`, `J309`, dll).
4. **Unggah Foto Manometer**:
   * Tarik dan lepas (*drag & drop*) foto ke kotak pengunggahan atau klik untuk memilih file foto.
   * Anda juga bisa menggunakan contoh foto yang sudah disediakan: `sample_manometer.jpg`.
5. **Klik "✨ Deteksi Nilai Tekanan dengan Llama-3.2-11b Vision"**:
   * AI akan memindai jarum meteran dan mengeluarkan hasil bacaan (contoh: `2.40 bar`, `24.47 mH2O`, `Confidence: 95%`).
   * Operator dapat melihat preview foto dan menyesuaikan angka jika diperlukan.
6. **Klik "💾 Terapkan ke Jaringan & Hitung Debit Sekarang"**:
   * Sistem langsung menyematkan status telemetri aktif (*pulsing radar icon*) pada junction tersebut di peta Subang.
   * Seluruh pipa yang terhubung akan otomatis terhitung debit alirannya (\(Q\)) dan berubah warna sesuai status aliran.

---

## 4. Cara Perhitungan Debit Air (\(Q\)) Berdasarkan Tekanan (\(P\))

Perhitungan hidrolika dilakukan menggunakan prinsip kekekalan energi dan persamaan kehilangan tinggi tekan **Hazen-Williams**:

1. **Total Dynamic Head (HGL)** pada titik 1 dan titik 2:
   \[
   H_1 = z_1 + (P_1 \times 10{,}197) \quad \text{dan} \quad H_2 = z_2 + (P_2 \times 10{,}197)
   \]
   *(di mana \(z\) adalah elevasi tanah mdpl, \(P\) adalah tekanan dalam bar, dan \(1 \text{ bar} = 10{,}197 \text{ m}\) air)*.

2. **Kehilangan Energi (*Head Loss* \(h_f\))**:
   \[
   h_f = |H_1 - H_2|
   \]

3. **Debit Aliran (\(Q\))**:
   \[
   Q = \left( \frac{h_f \cdot C^{1{,}852} \cdot D^{4{,}87}}{10{,}67 \cdot L} \right)^{\frac{1}{1{,}852}} \times 1000 \quad [\text{L/s}]
   \]
   * \(D\): Diameter dalam pipa (meter) dari data spesifikasi jaringan Subang.
   * \(L\): Panjang pipa (meter) dari data trase GIS Subang.
   * \(C\): Koefisien kekasaran Hazen-Williams (\(C = 140\) untuk seluruh jaringan pipa PVC).

4. **Kecepatan Aliran (\(v\))**:
   \[
   v = \frac{Q / 1000}{\frac{\pi}{4} D^2} \quad [\text{m/s}]
   \]

---

## 5. Legenda Warna & Indikator SCADA

| Warna Pipa | Status Aliran | Keterangan Operasional |
| :--- | :--- | :--- |
| **🔵 Biru Tua Tebal** | **Debit Tinggi (> 20 L/s)** | Pipa distribusi utama dari Reservoir R1/R2 mengalirkan debit besar ke pusat kota. |
| **🟢 Hijau** | **Optimal (0.3 – 2.0 m/s)** | Kecepatan aliran ideal sesuai standar teknis PDAM & SNI air minum. |
| **🟡 Kuning** | **Aliran Rendah (< 0.3 m/s)** | Aliran lambat / stagnan, waspadai potensi pengendapan partikel di pipa hilir. |
| **🔴 Merah** | **Indikasi Kebocoran (< 0.5 bar)** | Tekanan drop di bawah batas aman pelayanan, terdeteksi potensi pipa pecah/kebocoran. |

---

## 6. Fitur Tombol "Contoh Simulasi Lapangan"
Untuk mendemonstrasikan sistem secara instan kepada pimpinan atau tim teknis:
* Cukup klik tombol **"🧪 Contoh Simulasi Lapangan"** pada bagian atas layar.
* Sistem akan langsung memasukkan data telemetri realistis di 6 titik distribusi strategis Kota Subang (`J32`, `J307`, `J308`, `J309`, `J310`, `J311`).
* Anda akan melihat bagaimana debit pasokan air (L/s) dari Reservoir R1 dan R2 langsung terhitung dan terdistribusi ke seluruh pipa Kota Subang.

---

## 7. Titik Pantau Tekanan Ideal (Strategic Pressure Points)
Untuk mencegah tampilan peta yang penuh sesak dengan ratusan simpul perantara (*intermediate vertices*), sistem secara cerdas menyaring dan menetapkan **44 Titik Pantau Strategis**:
1. **💧 Sumber Reservoir (2 Titik)**: R1 (154 mdpl) dan R2 (155 mdpl) sebagai sumber utama energi gravitasi kota.
2. **🔀 Percabangan Distribusi Utama (32 Titik)**: Persimpangan pipa besar ($\varnothing \ge 150\text{ mm}$ atau $\ge 200\text{ mm}$) dengan $\ge 3$ arah pipa (titik bagi aliran antar-wilayah).
3. **⛰️ Zona Elevasi Kritis - Puncak & Lembah (4 Titik)**:
   - **Puncak Tertinggi** (J62, J63 - $154\text{ mdpl}$): Kawasan paling rawan air mati akibat defisit tekanan.
   - **Lembah Terendah** (J36, J37, J318 - $50 - 57\text{ mdpl}$): Kawasan paling rawan tekanan berlebih (*overpressure*) dan pipa pecah.
4. **🏘️ Distribusi Wilayah Pelayanan (6 Titik)**: Titik pantau utama di kawasan hunian/perkotaan Subang (J307–J311, J326).

> **Tip Operasional**: Gunakan tombol **"⭐ Mode: Titik Ideal (44)"** di toolbar atas untuk berpindah antara tampilan titik strategis atau melihat seluruh 314 simpul jaringan pipa.

---

## 8. Fitur Import & Analisa Daerah Baru (Multi-Wilayah)
Aplikasi kini mendukung analisa jaringan pipa untuk **daerah / cabang pelayanan lain** (seperti Cabang Ciasem, Pamanukan, Cisalak, atau proyek IKK lainnya):

### Cara Mengimport Jalur Pipa Baru:
1. Klik tombol **"🗺️ Wilayah: Subang Kota ▾"** di toolbar atas.
2. Pilih tab **"➕ Import Daerah / Pipa Baru"**.
3. **Unggah Berkas**: Tarik & lepas (*drag & drop*) berkas pipa Anda:
   - **`.kml`**: Berkas digitasi dari **Google Earth**, **QGIS**, atau **AutoCAD Map**.
   - **`.json`**: Berkas jaringan pipa dari **EPANET** atau **SCADA**.
   - **`.geojson`**: Standar data spasial GIS.
4. Tentukan **Nama Wilayah** (contoh: *Cabang Ciasem*).
5. Atur **Diameter Pipa Default** (default: $100\text{ mm}$, material PVC $C=140$).
6. Klik **"🚀 Import & Mulai Analisa Wilayah Ini"**.

### Apa yang Dilakukan Sistem Secara Otomatis:
* Peta langsung bergeser (*fitBounds*) ke koordinat geografis wilayah baru.
* Sistem otomatis menyambungkan simpul pipa (*topological snapping*) dan menghitung panjang pipa riil.
* Sistem otomatis mendeteksi dan mengklasifikasikan **Titik Pantau Tekanan Strategis** di wilayah baru tersebut.
* Sistem langsung menjalankan perhitungan hidrolik Hazen-Williams untuk estimasi tekanan dan aliran air.
* Anda dapat dengan mudah beralih kembali ke Subang Kota atau wilayah lain kapan saja melalui menu **"📂 Wilayah Tersimpan"**.

