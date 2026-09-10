export const metadata = {
  title: "Palladium Point",
  description: "Candidate, firm, engagement, pipeline, and outreach system of record.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
