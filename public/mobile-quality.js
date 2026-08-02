const eightKPhoto = "/scenes/lake-valley-landscape-7680.webp";
const photo = document.querySelector("#photo-backdrop-image");
const responsiveSources = document.querySelectorAll("#photo-backdrop source");

// Keep the original 8K WebP as the visible image at every viewport size.
// The animated canvas was rendered below the source resolution and softened
// the photograph when placed above it, so remove that layer.
document.querySelector("#photo-background")?.remove();

for (const source of responsiveSources) {
  source.setAttribute("type", "image/webp");
  source.setAttribute("srcset", `${eightKPhoto} 7680w`);
  source.setAttribute("sizes", "100vw");
}

if (photo) {
  photo.src = eightKPhoto;
  photo.srcset = `${eightKPhoto} 7680w`;
  photo.sizes = "100vw";
  photo.decoding = "async";
  photo.loading = "eager";
  photo.fetchPriority = "high";
}
