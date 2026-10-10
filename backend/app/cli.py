"""Administrative commands.

    python -m app.cli create-admin --email you@example.com --name "Your Name"

The password is read from the ADMIN_PASSWORD environment variable if set,
otherwise prompted for (never passed on the command line, where it would land
in shell history).
"""

import argparse
import getpass
import os
import sys

from sqlalchemy import func, select

from .db import SessionLocal
from .models import User
from .routers.uploads import cleanup_expired_uploads
from .security import destroy_user_sessions, hash_password, password_problem


def _password() -> str:
    pw = os.environ.get("ADMIN_PASSWORD")
    if pw:
        return pw
    if not sys.stdin.isatty():
        sys.exit("Set ADMIN_PASSWORD or run interactively (docker compose exec -it ...).")
    pw = getpass.getpass("Password: ")
    if pw != getpass.getpass("Repeat password: "):
        sys.exit("Passwords do not match.")
    return pw


def create_admin(email: str, name: str) -> None:
    email = email.strip().lower()
    pw = _password()
    if problem := password_problem(pw):
        sys.exit(problem)
    with SessionLocal() as db:
        existing = db.scalar(select(User).where(func.lower(User.email) == email))
        if existing:
            existing.role = "admin"
            existing.is_active = True
            existing.password_hash = hash_password(pw)
            existing.must_change_password = False
            destroy_user_sessions(db, existing.id)
            print(f"Updated {email}: administrator, password reset.")
        else:
            db.add(User(email=email, display_name=name.strip() or email, role="admin",
                        password_hash=hash_password(pw)))
            print(f"Created administrator {email}.")
        db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("create-admin", help="Create an administrator, or reset one's password")
    p.add_argument("--email", required=True)
    p.add_argument("--name", default="")
    sub.add_parser("cleanup-uploads", help="Delete abandoned partial uploads")
    args = parser.parse_args()

    if args.cmd == "create-admin":
        create_admin(args.email, args.name)
    elif args.cmd == "cleanup-uploads":
        print(f"Removed {cleanup_expired_uploads()} item(s).")


if __name__ == "__main__":
    main()
