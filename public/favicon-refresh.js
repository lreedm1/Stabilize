const VECTOR_ICON_ID = "stabilize-vector-tab-icon";
const INLINE_ICON_ID = "stabilize-inline-tab-icon";
const VECTOR_ICON_HREF = "/stabilize-tab-20260813.svg";
const INLINE_ICON_HREF = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACXklEQVR42mNgGGDAiEtC3N7wPzUtennwPCNRDqC2xYQcwkRPy7HZwURPy7HZxUJLi85W6sHZxu2XsKphopXvkS3HxofZyTTQ2XD4OgA9znGlAZISYaCjM0OUpxeDjrIKAy83N8P3nz8ZPn35wvDk1UuGO48fMSzYtJHh8p3bBC0lywH9xWUMkR6eKGK8XFwMvFxcDNJiYgzmOroM565fR3EAMYAoB9gYGMIt//ztG0N2eyvD8UsXGP79/88gKy7BoKeqyuBn78jw6/dvkqOKKAc4m1vA2ftPn2LYdeIYnH/jwX2GGw/uM6zavYt2iZCPmxvONtPRZdBVUaVaYiUqBB48ewZnSwgLM+yePovh3tMnDMcvXWQ4efkSw8GzZxlevntLfnVMqCSUFhNjODJvEQMnOztW+X///zNs2L+PoXLyRIaPXz6TVDMSFQVPX71iSG9pYnjz4QP2eGRkZAhycmaYUl5JmxCAAU52dgYvG1sGBxNTBjsjYwZxIWEMNaYxkQyPX74gOgRIKoi+//zJsHbvHoa1e/cwMDAwMGgpKTFUJ6cxOJuZw9UoSEkR7QCKi+Jr9+4x9CxegCL28csX6ueCvMhoBlMtbYY9J08wnL95g+HF2zcM7z99YpASFWXICg2Hq3v9/j3DtXt3qe8ALg4OBlcLSwZXC0ucav7++8dQPrGf4c/fv9R3wOrdOxk+ff3KYKypxaAmJ8cgyMfPwM/Dw/Dv3z+GZ29eM5y6cplh9rq1DFfu3qFtLqBFC3lwNEhwdRro0T8YPE0yeoYCsl1MxPTfaNk1G/DO6YADAJI04i4LCcRWAAAAAElFTkSuQmCC";

function appendIcon({ id, href, type, sizes }) {
  const icon = document.createElement("link");
  icon.id = id;
  icon.rel = "icon";
  icon.type = type;
  icon.sizes = sizes;
  icon.href = href;
  document.head.append(icon);
}

function installTabIcons() {
  for (const icon of document.querySelectorAll('link[rel~="icon"]')) {
    icon.remove();
  }
  appendIcon({
    id: VECTOR_ICON_ID,
    href: VECTOR_ICON_HREF,
    type: "image/svg+xml",
    sizes: "any",
  });
  appendIcon({
    id: INLINE_ICON_ID,
    href: INLINE_ICON_HREF,
    type: "image/png",
    sizes: "32x32",
  });
}

installTabIcons();
window.addEventListener("pageshow", installTabIcons);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) installTabIcons();
});
