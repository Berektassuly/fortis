import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="glass w-full max-w-md rounded-3xl p-8 text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Страница не найдена</p>
        <Link href="/" className="text-primary underline underline-offset-4 hover:text-primary/90">
          Вернуться на главную
        </Link>
      </div>
    </div>
  );
}
