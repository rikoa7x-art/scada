# 🚀 Panduan Deploy SCADA PDAM Kota Subang ke GitHub Pages

Panduan lengkap langkah demi langkah untuk mengunggah (*deploy*) aplikasi SCADA Subang ke **GitHub Pages** agar dapat diakses dari mana saja secara gratis melalui peramban (*browser*) *smartphone* Android, iPhone, tablet, maupun komputer.

---

## 🌟 Keunggulan Versi Web Statis (GitHub Pages Ready)

1. **100% Gratis Selamanya & Tanpa Sewa Server**: Tidak memerlukan VPS, hosting bulanan, atau instalasi Node.js di cloud.
2. **Sangat Ringan (< 500 KB)**: Halaman langsung terbuka dalam hitungan detik meski menggunakan jaringan seluler 3G/4G di pelosok.
3. **Penyimpanan Lokal Mandiri (*LocalStorage*)**: Semua input tekanan manometer tersimpan aman di memori HP masing-masing petugas, tidak akan hilang saat browser di-refresh atau kuota internet habis.
4. **PWA (Progressive Web App)**: Bisa dipasang ke Layar Utama (*Add to Home Screen*) HP layaknya aplikasi Android/iOS asli.
5. **GPS Lapangan Terintegrasi**: Membaca sensor GPS ponsel untuk mendeteksi simpul pipa terdekat secara otomatis.

---

## 📋 Langkah 1: Buat Repository di GitHub

1. Buka situs [https://github.com](https://github.com) dan masuk ke akun GitHub Anda.
2. Di pojok kanan atas, klik tanda **`+`** lalu pilih **`New repository`**.
3. Isi informasi repository:
   - **Repository name**: `scada-subang` *(atau nama lain sesuai keinginan)*
   - **Visibility**: Pilih **Public** *(agar fitur GitHub Pages gratis aktif)*
   - **Initialize this repository with**: **JANGAN** centang *Add a README file*, *Add .gitignore*, ataupun *license* (biarkan kosong).
4. Klik tombol hijau **`Create repository`**.

---

## 💻 Langkah 2: Upload File dari Komputer ke GitHub

1. Buka folder SCADA di komputer Anda: `C:\Users\USER\Desktop\scada`.
2. Klik kanan di area kosong folder tersebut, pilih **Open in Terminal** atau **Git Bash Here** (atau buka PowerShell/Command Prompt dan ketik `cd C:\Users\USER\Desktop\scada`).
3. Jalankan perintah Git berikut satu per satu:

```bash
# Inisialisasi git lokal
git init

# Tambahkan semua berkas ke git
git add .

# Buat catatan commit
git commit -m "Inisialisasi SCADA PDAM Kota Subang Mobile-First"

# Ubah branch utama menjadi main
git branch -M main

# Hubungkan folder lokal ke repository GitHub Anda
# (GANTI 'USERNAME_ANDA' DENGAN USERNAME GITHUB ANDA SENDIRI!)
git remote add origin https://github.com/USERNAME_ANDA/scada-subang.git

# Unggah file ke GitHub
git push -u origin main
```

> [!NOTE]
> Jika diminta login oleh GitHub di terminal/browser, lakukan otorisasi akun Anda hingga proses `git push` selesai 100%.

---

## ⚙️ Langkah 3: Mengaktifkan GitHub Pages (1 Menit Selesai)

1. Buka halaman repository yang baru saja Anda buat di browser:
   `https://github.com/USERNAME_ANDA/scada-subang`
2. Klik tab **Settings** (ikon roda gerigi di kanan atas halaman repo).
3. Di bilah menu sebelah kiri, gulir dan klik **Pages** (pada bagian *Code and automation*).
4. Pada bagian **Build and deployment**:
   - **Source**: Pilih **`Deploy from a branch`**
   - **Branch**: Pilih **`main`**, lalu foldernya biarkan **`/ (root)`**
   - Klik tombol **Save**.
5. Tunggu sekitar 1 hingga 2 menit (GitHub sedang mempublikasikan situs Anda).
6. Refresh halaman tersebut. Anda akan melihat notifikasi berlatar belakang hijau:
   > **Your site is live at `https://USERNAME_ANDA.github.io/scada-subang/`**

Tautan (*link*) di atas adalah alamat resmi SCADA PDAM Subang yang dapat diakses oleh siapa saja dari mana saja!

---

## 📱 Langkah 4: Memasang di Smartphone Petugas (Add to Home Screen)

Aplikasi ini sudah dilengkapi teknologi **Progressive Web App (PWA)** sehingga dapat dipasang ke layar utama HP tanpa harus mengunduh dari Google Play Store atau App Store:

### Untuk HP Android (Google Chrome):
1. Buka tautan GitHub Pages Anda (`https://USERNAME_ANDA.github.io/scada-subang/`) di Google Chrome.
2. Ketuk ikon titik tiga (**`⋮`**) di pojok kanan atas Chrome.
3. Pilih menu **"Tambahkan ke Layar Utama"** (*Add to Home screen*) atau **"Instal Aplikasi"**.
4. Ketuk **Instal**. Ikon logo PDAM Subang akan langsung muncul di layar utama smartphone Anda.

### Untuk iPhone / iPad (Apple Safari):
1. Buka tautan di peramban Safari.
2. Ketuk tombol **Bagikan / Share** (ikon kotak dengan panah mengarah ke atas di bagian bawah layar).
3. Gulir ke bawah lalu ketuk **"Tambah ke Layar Utama"** (*Add to Home Screen*).
4. Ketuk **Tambah** di pojok kanan atas.

---

## 🛠️ Panduan Fitur Smartphone Lapangan

1. **Deteksi Simpul Pipa Terdekat (Tombol GPS 📍)**:
   - Saat petugas berada di ruas jalan tertentu di Kota Subang (misal Jl. Otista atau Dangdeur), ketuk tombol bundar **`📍`** di pojok kanan bawah peta.
   - Peramban akan meminta izin lokasi (pilih *Izinkan/Allow*).
   - Peta langsung memposisikan titik Anda dengan lingkaran biru dan memunculkan jendela:
     > *"Anda berjarak 25 meter dari Simpul J14 (Jl. Otista) — [✍️ Ukur Tekanan di J14]"*
2. **Input Tekanan Super Cepat (Satu Jempol)**:
   - Ketuk tab **`✍️ Ukur`** di bagian bawah.
   - Gunakan tombol *stepper* cepat (`-0.5`, `-0.1`, `+0.1`, `+0.5`) atau preset (`1.0`, `1.5`, `2.0`, `2.5 bar`).
   - Ketuk tombol hijau **Simpan Tekanan**. Seketika debit air ($Q$) di seluruh pipa terhubung langsung terhitung dan garis pipa mengalirkan animasi!
3. **Navigasi Bawah Praktis**:
   - **`🗺️ Peta`**: Tampilan penuh peta jaringan pipa.
   - **`📡 Sensor`**: Membuka laci daftar 45 titik pantau strategis per zona (Pasirkareumbi, Subang Kota, Sukamelang, Soklat, Dangdeur, Majasari).
   - **`🌊 Pipa`**: Melihat pipa dengan debit aliran tertinggi ($Q$).
   - **`🚨 Anomali`**: Notifikasi peringatan dini jika ada tekanan drop / potensi pipa bocor (< 0.5 bar).
4. **Berbagi Data Antar Petugas (Cadangkan & Pulihkan JSON)**:
   - Buka menu alat (ketuk **`⋮`** di kanan atas).
   - Pilih **`💾 Cadangkan Data (JSON)`**: Berkas pengukuran akan tersimpan di folder *Downloads* HP.
   - Kirimkan file tersebut via WhatsApp ke petugas lain atau komputer kantor.
   - Di HP lain, cukup buka menu **`📥 Pulihkan Data (JSON)`** dan pilih berkas tersebut. Semua data pengukuran langsung sinkron seketika!

---

## 🔄 Pembaruan Data di Masa Mendatang

Jika sewaktu-waktu Anda memperbarui data jaringan pipa atau mengubah tampilan:
1. Simpan perubahan di folder komputer `C:\Users\USER\Desktop\scada`.
2. Buka terminal dan ketik:
   ```bash
   git add .
   git commit -m "Update data jaringan pipa Subang"
   git push
   ```
3. GitHub Pages akan otomatis memperbarui situs web Anda dalam 1 menit!
