const mobilePortrait = globalThis.matchMedia?.(
  "(max-width: 980px) and (orientation: portrait)",
);

function decodeBase64(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

if (mobilePortrait?.matches) {
  const backdrop = document.querySelector("#photo-backdrop");
  const terrain = document.querySelector("#terrain-background");

  if (backdrop instanceof HTMLElement) {
    document.documentElement.dataset.mobileBackground = "loading-video";

    void Promise.all([
      import("/mobile-creek-video-0.js?v=20260802-7"),
      import("/mobile-creek-video-1.js?v=20260802-7"),
      import("/mobile-creek-video-2.js?v=20260802-7"),
      import("/mobile-creek-video-3.js?v=20260802-7"),
      import("/mobile-creek-video-4.js?v=20260802-7"),
      import("/mobile-creek-video-5.js?v=20260802-7"),
      import("/mobile-creek-video-6.js?v=20260802-7"),
      import("/mobile-creek-video-7.js?v=20260802-7"),
    ])
      .then((parts) => parts.map((part) => part.default).join(""))
      .then((encoded) => {
        const objectUrl = URL.createObjectURL(
          new Blob([decodeBase64(encoded)], { type: "video/mp4" }),
        );
        const video = document.createElement("video");

        video.id = "mobile-creek-video";
        video.className = "mobile-creek-video";
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = "auto";
        video.disablePictureInPicture = true;
        video.setAttribute("muted", "");
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.setAttribute("aria-hidden", "true");
        video.src = objectUrl;

        Object.assign(video.style, {
          position: "fixed",
          zIndex: "0",
          inset: "0",
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "50% 50%",
          pointerEvents: "none",
          opacity: "0",
          transition: "opacity 350ms ease",
        });

        backdrop.style.transition = "opacity 350ms ease";
        backdrop.insertAdjacentElement("afterend", video);

        let finished = false;
        const revealVideo = () => {
          if (finished) return;
          finished = true;
          video.style.opacity = "1";
          backdrop.style.opacity = "0";
          document.querySelector("#photo-background")?.remove();
          terrain?.classList.add("is-photo-ready");
          document.documentElement.dataset.mobileBackground = "video-playing";
        };

        const failVideo = (error) => {
          if (finished) return;
          finished = true;
          document.documentElement.dataset.mobileBackground = "video-failed";
          console.error("Mobile creek video failed to play", error);
          backdrop.style.opacity = "1";
          URL.revokeObjectURL(objectUrl);
          video.remove();
        };

        video.addEventListener("playing", revealVideo, { once: true });
        video.addEventListener(
          "error",
          () => failVideo(video.error ?? new Error("Video playback failed")),
          { once: true },
        );

        void video.play().catch(failVideo);
        window.addEventListener(
          "pagehide",
          () => URL.revokeObjectURL(objectUrl),
          { once: true },
        );
      })
      .catch((error) => {
        document.documentElement.dataset.mobileBackground = "video-failed";
        console.error("Mobile creek video failed to load", error);
      });
  }
}
