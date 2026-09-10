export const metadata = {
  title: "Palladium OS",
  description: "The ATS and sole record of truth for Palladium Point's active pipeline and commission ledger.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#fafafa", color: "#111" }}>
        {children}
      </body>
    </html>
  );
}
