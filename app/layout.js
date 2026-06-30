import "./globals.css";

export const metadata = {
  title: "Zeno Wallet",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* proxima-nova, per the Xaman xApp style guide. */}
        <link rel="stylesheet" href="https://use.typekit.net/vtt7ckl.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
