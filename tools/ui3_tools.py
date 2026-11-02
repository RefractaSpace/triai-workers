"""새 도구들 화면 시험: 코드 실행(진짜 Pyodide) · 내 컴퓨터 도구(가짜 윈도우 앱) · 로컬 모델(가짜 Ollama) · 그림 · MCP · 에이전트 · 설정 화면"""
import sys, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
B = "http://127.0.0.1:8787"
errs = []
FAKE_APP = """window.TriAIApp={platform:()=>"desktop",deviceCatalog:async()=>({os:"win32",folders:["C:/Users/me"],commands:true,screenshot:true,mcp:[]}),
 runTool:async r=>{window.__ran=(window.__ran||[]).concat([r.name]);return {ok:true,text:"Desktop\\nDocuments\\n메모.txt"}},
 screenshot:async()=>"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
 openDeviceSettings:()=>{},onQuickAsk:()=>{}};
 try{localStorage.setItem("triai.localOn","true")}catch(e){}"""
def watch(p):
    p.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    p.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    p.on("response", lambda r: errs.append(f"http {r.status} {r.url}") if r.status >= 400 and "/gw/login" not in r.url else None)
def last_answer(p): return p.locator(".turn").last.locator(".a .md").inner_text()
def ask(p, text, pick=None, wait_text=None, timeout=60000):
    if pick:
        p.click("#pickBtn"); p.locator("#menu .mi", has_text=pick).first.click()
    p.fill("#input", text); p.keyboard.press("Enter")
    idle = "() => !document.querySelector('#send').classList.contains('stop') && !document.querySelector('.turn .a-status')"
    for _ in range(3):
        p.wait_for_timeout(700); p.wait_for_function(idle, timeout=timeout)
    t = last_answer(p)
    ok = (wait_text in t) if wait_text else True
    print(f"[{'OK' if ok else 'FAIL'}] {text!r} → {t[-160:]!r}".replace("\\n", " "))
    return t
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1360, "height": 900})
    ctx.add_init_script(FAKE_APP)
    p = ctx.new_page(); watch(p)
    p.goto(B + "/gw/login"); p.fill("#u", "kuro"); p.fill("#p", "newpass-123"); p.click("button"); p.wait_for_url(B + "/"); p.wait_for_timeout(1000)
    print("app button:", p.is_visible("#shotBtn"))
    ask(p, "코드 테스트 해줘", pick="Claude", wait_text="1.41421356", timeout=120000)
    p.screenshot(path=f"{OUT}/t1_run.png")
    ask(p, "도구 테스트 해줘", wait_text="Desktop")
    print("app ran:", p.evaluate("window.__ran"))
    p.screenshot(path=f"{OUT}/t2_tool.png")
    ask(p, "MCP 테스트", wait_text="Overview")
    p.screenshot(path=f"{OUT}/t3_mcp.png")
    # 그림: 설정 → 도구 → 그림 만들기 켜기
    p.click("#meBtn"); p.locator(".sh-nav [data-t=tools]").click(); p.wait_for_timeout(400)
    p.screenshot(path=f"{OUT}/t4_set_tools.png")
    p.locator("[data-k=image_tool]").check(); p.wait_for_timeout(400)
    p.locator(".sh-nav [data-t=connections]").click(); p.wait_for_timeout(600); p.screenshot(path=f"{OUT}/t5_set_conn.png")
    p.locator(".sh-nav [data-t=local]").click(); p.wait_for_timeout(300); p.click("#lFind"); p.wait_for_timeout(1500); p.screenshot(path=f"{OUT}/t6_set_local.png")
    p.locator(".sh-nav [data-t=agents]").click(); p.wait_for_timeout(600); p.screenshot(path=f"{OUT}/t7_set_agents.png")
    p.keyboard.press("Escape"); p.wait_for_timeout(300)
    p.evaluate("location.reload()"); p.wait_for_timeout(1200)
    ask(p, "그림 테스트", wait_text="도구 결과")
    print("image in answer:", p.locator(".turn").last.locator(".md img[src^='/api/uploads/']").count())
    ask(p, "에이전트야 안녕", pick="에이전트 팀", wait_text="Commander")
    p.click("#pickBtn"); p.wait_for_timeout(200); p.screenshot(path=f"{OUT}/t8_pick.png")
    p.locator("#menu .mi", has_text="qwen3:8b").first.click()
    ask(p, "로컬로 안녕", wait_text="로컬 모델이에요")
    ask(p, "로컬로 코드 계산", wait_text="42", timeout=120000)
    p.screenshot(path=f"{OUT}/t9_local.png")
    # 새로고침해도 저장돼 있는지
    p.evaluate("location.reload()"); p.wait_for_timeout(1500)
    print("after reload last:", last_answer(p)[-60:].replace("\n", " "))
    print("errors:", "\n".join(errs) if errs else "none")
    b.close()
