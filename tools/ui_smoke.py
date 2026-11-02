from playwright.sync_api import sync_playwright
errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch(); p = b.new_page(viewport={"width": 1280, "height": 860})
    p.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    p.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    p.on("response", lambda r: errs.append(f"http {r.status} {r.url}") if r.status >= 400 and "/gw/login" not in r.url else None)
    p.goto("http://127.0.0.1:8787/gw/login"); p.fill("#u", "kuro"); p.fill("#p", "password123"); p.click("button")
    p.wait_for_url("http://127.0.0.1:8787/"); p.wait_for_timeout(1500)
    p.screenshot(path="shot_home.png")
    ta = p.locator("textarea").first; ta.fill("로켓 노즐 설명해줘"); ta.press("Enter")
    p.wait_for_timeout(4000); p.screenshot(path="shot_chat.png")
    print("errors:", "\n".join(errs) if errs else "none")
    b.close()
