/**
 * AI Vision Reader for Water Pressure Gauges (Manometer)
 * Model: meta/llama-3.2-11b-vision-instruct
 * Provider: NVIDIA NIM API
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.AIVisionReader = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
  const MODEL_NAME = 'meta/llama-3.2-11b-vision-instruct';
  const AI_REQUEST_TIMEOUT_MS = 30000;

  const SYSTEM_PROMPT = `Anda adalah ahli instrumentasi hidrolika dan pembaca meteran tekanan air (manometer / pressure gauge) PDAM.
Tugas Anda adalah membaca nilai tekanan yang ditunjukkan pada foto manometer dengan tingkat ketelitian tinggi.

Aturan pembacaan:
1. Periksa apakah manometer berupa dial jarum analog atau display digital LCD.
2. Jika analog: perhatikan ujung jarum penunjuk menunjuk ke angka berapa pada skala utama (biasanya bar, kg/cm2, atau psi).
3. Jika pada manometer terdapat 2 skala (misalnya bar warna hitam/merah dan psi warna lain), prioritaskan skala 'bar' atau 'kg/cm2' (1 kg/cm2 ≈ 0.98 bar ≈ 1 bar). Jika hanya ada psi, catat satuannya psi.
4. Identifikasi unit satuan: 'bar', 'mH2O' (meter air), 'psi', atau 'kg/cm2'.
5. Nilai tekanan air jaringan pipa PDAM perkotaan umumnya berkisar antara 0.2 hingga 6.0 bar.
6. Berikan tingkat keyakinan (confidence) antara 0.0 sampai 1.0 berdasarkan kejernihan foto dan posisi jarum.

KEMBALIKAN HANYA FORMAT JSON MURNI TANPA MARKDOWN DAN TANPA TEKS LAIN:
{
  "pressure": <angka_desimal_tekanan>,
  "unit": "<bar|mH2O|psi|kg/cm2>",
  "pressure_bar": <nilai_dikonversi_ke_bar_dalam_angka>,
  "pressure_m": <nilai_dikonversi_ke_meter_air_dalam_angka>,
  "gauge_type": "<analog|digital>",
  "confidence": <0.0_sampai_1.0>,
  "notes": "<keterangan singkat posisi jarum/angka yang terbaca>"
}`;

  function normalizePressure(value, unit) {
    const u = (unit || 'bar').toLowerCase().trim();
    let bar = parseFloat(String(value).replace(',', '.')) || 0;

    if (u.includes('psi')) {
      bar = bar / 14.5038;
    } else if (u.includes('kg/cm') || u === 'kg') {
      bar = bar * 0.980665;
    } else if (u.includes('kpa')) {
      bar = bar / 100;
    } else if (u.includes('mpa')) {
      bar = bar * 10;
    } else if (u.includes('mh2o') || u.includes('meter air') || u === 'meter') {
      bar = bar / 10.197;
    }

    const mH2O = bar * 10.197;
    return {
      bar: Math.round(bar * 1000) / 1000,
      m: Math.round(mH2O * 100) / 100
    };
  }

  function detectMimeType(base64String) {
    if (base64String.startsWith('data:image/')) {
      return base64String;
    }
    if (base64String.startsWith('iVBOR')) return 'data:image/png;base64,' + base64String;
    if (base64String.startsWith('R0lGOD')) return 'data:image/gif;base64,' + base64String;
    if (base64String.startsWith('UklGR')) return 'data:image/webp;base64,' + base64String;
    return 'data:image/jpeg;base64,' + base64String;
  }

  async function analyzePressureGauge(imageBase64, apiKey) {
    if (!apiKey) {
      throw new Error('API Key NVIDIA NIM tidak ditemukan. Pastikan NVIDIA_API_KEY diatur di file .env');
    }

    const imageUrl = detectMimeType(imageBase64);

    const payload = {
      model: MODEL_NAME,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Tolong baca manometer ini secara teliti. Berapa angka tekanan air yang ditunjukkan jarum atau display? Kembalikan JSON persis seperti format yang diminta.'
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl
              }
            }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 512
    };

    const fetchOptions = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    };

    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      fetchOptions.signal = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
    }

    let response;
    try {
      response = await fetch(NVIDIA_API_URL, fetchOptions);
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new Error(`Timeout: NVIDIA API tidak merespon dalam ${AI_REQUEST_TIMEOUT_MS / 1000} detik. Periksa koneksi internet.`);
      }
      throw new Error(`Gagal terhubung ke NVIDIA API: ${err.message}`);
    }

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        throw new Error('Rate limit NVIDIA API terlampaui. Tunggu beberapa detik lalu coba lagi.');
      }
      throw new Error(`NVIDIA API Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    let parsed = null;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(rawText);
      }
    } catch (e) {
      const numMatch = rawText.match(/(\d+[.,]?\d*)\s*(bar|psi|kg\/cm2|mh2o|mH2O)/i);
      if (numMatch) {
        const val = parseFloat(numMatch[1].replace(',', '.'));
        const unit = numMatch[2].toLowerCase();
        parsed = {
          pressure: val,
          unit: unit,
          gauge_type: 'analog',
          confidence: 0.7,
          notes: rawText.substring(0, 120)
        };
      } else {
        throw new Error(`AI tidak mengembalikan format JSON valid: ${rawText}`);
      }
    }

    const rawPressure = Number(parsed.pressure) || 0;
    if (rawPressure < 0 || rawPressure > 25) {
      console.warn(`⚠️ Nilai tekanan AI (${rawPressure} ${parsed.unit}) di luar rentang normal distribusi air`);
    }

    const norm = normalizePressure(parsed.pressure, parsed.unit);
    return {
      pressure: parsed.pressure,
      unit: parsed.unit || 'bar',
      pressure_bar: norm.bar,
      pressure_m: norm.m,
      gauge_type: parsed.gauge_type || 'analog',
      confidence: (parsed.confidence !== undefined && parsed.confidence !== null) ? Number(parsed.confidence) : 0.85,
      notes: parsed.notes || 'Berhasil dideteksi oleh Llama-3.2-11b Vision',
      timestamp: new Date().toISOString()
    };
  }

  return {
    analyzePressureGauge,
    normalizePressure,
    detectMimeType,
    MODEL_NAME
  };

});
