export const metadata = {
  title: "Palladium OS",
  description:
    "Orchestration, ledger, and intelligence layer above Crelate, QuickBooks, Gmail, Calendar, and Slack.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
