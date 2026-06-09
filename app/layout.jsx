import "./globals.css";
import { AppShell } from "./components/AppShell";

export const metadata = {
  title: "Smartling Jobs",
  description: "Submit and review standalone Smartling translation jobs."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
