import "./globals.css";

export const metadata = {
  title: "Palladium OS",
  description: "The ATS and sole record of truth for Palladium Point's active pipeline and commission ledger.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
