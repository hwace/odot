// 자리표시용 페이지. 프론트엔드 디자인이 들어오면 통째로 교체한다.
export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>odot backend</h1>
      <p style={{ color: "#666", marginTop: 8 }}>
        API는 <code>/api/*</code> 에서 동작합니다. 명세는 <code>docs/API.md</code>를 보세요.
      </p>
      <p style={{ color: "#666" }}>
        배선 확인: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
