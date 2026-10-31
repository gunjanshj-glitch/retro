import type { Metadata } from "next";
import Script from "next/script";
import { display, interface_ } from "./fonts";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { RouteTracker } from "@/components/analytics/RouteTracker";
import { ADS_ID, GA_ID } from "@/lib/analytics";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retro Holidays",
  description: "Retro Holidays — trips people still talk about.",
  verification: {
    google: "MRzxN3-6OZYa9fKnLQ2qlRS0gNMxEgslwaWGETpjweA",
  },
};

const GTM_ID = "GTM-N3B5DC7M";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${interface_.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        <Script id="gtm" strategy="lazyOnload">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`}
        </Script>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="lazyOnload"
        />
        <Script id="gtag-init" strategy="lazyOnload">
          {`window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
gtag('config','${GA_ID}');
gtag('config','${ADS_ID}');`}
        </Script>
        <RouteTracker />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
