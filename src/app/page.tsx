import { redirect } from "next/navigation";

/**
 * 앱 화면은 팀원이 만든 public/app.html 이다.
 * 루트는 next.config.ts 의 redirects() 가 먼저 처리하지만,
 * 그 설정이 빠지더라도 빈 화면이 뜨지 않도록 여기서도 보낸다.
 */
export default function Home() {
  redirect("/app.html");
}
