from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote
import hashlib
import json
import secrets
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data.json"
SESSIONS = {}
APP_VERSION = "main-stock-entry-52week-v1"


def now_ms():
    return int(time.time() * 1000)


def calculate_deployment(starting_price, lower_limit, order_qty, buy_entry_step, buy_exit_step=0):
    levels = []
    if buy_entry_step <= 0:
        return 0, 0, 0, 0, 0

    entry_count = int(((starting_price - lower_limit) / buy_entry_step) + 1e-9)
    for index in range(1, min(entry_count, 10000) + 1):
        levels.append(round(starting_price - buy_entry_step * index, 2))
    if not levels:
        return 0, 0, 0, 0, 0

    total_fund = sum(price * order_qty for price in levels)
    avg_price = total_fund / (len(levels) * order_qty) if levels and order_qty else 0
    profit_per_step = max(buy_exit_step, 0) * order_qty
    total_profit = profit_per_step * len(levels)
    return len(levels), total_fund, avg_price, profit_per_step, total_profit


def hash_password(password):
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def default_data():
    return {
        "users": [
            {
                "code": "ADMIN",
                "name": "Admin",
                "passwordHash": hash_password("admin123"),
                "role": "admin",
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        ],
        "records": [],
    }


def read_data():
    if not DATA_FILE.exists():
        write_data(default_data())

    try:
        with DATA_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except json.JSONDecodeError:
        data = default_data()

    if not any(user.get("code") == "ADMIN" for user in data.get("users", [])):
        data.setdefault("users", []).insert(0, default_data()["users"][0])
        write_data(data)

    data.setdefault("records", [])
    data.setdefault("users", [])
    return data


def write_data(data):
    with DATA_FILE.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2)


def public_user(user):
    return {
        "code": user["code"],
        "name": user["name"],
        "role": user["role"],
        "brokerName": user.get("brokerName", ""),
        "createdAt": user.get("createdAt"),
    }


def create_token(code):
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = {"code": code, "expires": now_ms() + 12 * 60 * 60 * 1000}
    return token


def get_json_body(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length == 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def normalize_code(value):
    return str(value or "").strip().upper()


def yahoo_get(path):
    request = urllib.request.Request(
        f"https://query1.finance.yahoo.com{path}",
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def yahoo_search(query):
    safe_query = quote(query)
    request = urllib.request.Request(
        f"https://query2.finance.yahoo.com/v1/finance/search?q={safe_query}&quotesCount=12&newsCount=0",
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))

    results = []
    for quote_item in payload.get("quotes", []):
        symbol = quote_item.get("symbol")
        name = quote_item.get("shortname") or quote_item.get("longname") or quote_item.get("name") or symbol
        quote_type = quote_item.get("quoteType")
        if not symbol or quote_type not in {"EQUITY", "ETF", "MUTUALFUND"}:
            continue
        if not symbol.upper().endswith(".NS"):
            continue

        exchange = quote_item.get("exchange") or quote_item.get("exchDisp") or ""
        results.append(
            {
                "symbol": symbol,
                "name": name,
                "exchange": exchange,
                "label": f"{symbol} - {name}",
            }
        )

    return results


def yahoo_52_week_range(symbol):
    payload = yahoo_get(f"/v8/finance/chart/{quote(symbol)}?range=1y&interval=1d")
    result = payload.get("chart", {}).get("result", [])
    if not result:
        return None, None

    quote_data = (result[0].get("indicators", {}).get("quote") or [{}])[0]
    highs = []
    lows = []
    for value in quote_data.get("high", []):
        if value is not None:
            highs.append(float(value))
    for value in quote_data.get("low", []):
        if value is not None:
            lows.append(float(value))

    high = max(highs) if highs else None
    low = min(lows) if lows else None
    return high, low


def yahoo_quote(symbol):
    symbol = symbol.strip().upper()
    if not symbol.endswith(".NS"):
        return None

    payload = yahoo_get(f"/v8/finance/chart/{quote(symbol)}?range=1d&interval=1m")
    result = payload.get("chart", {}).get("result", [])
    if not result:
        return None

    meta = result[0].get("meta", {})
    price = meta.get("regularMarketPrice") or meta.get("previousClose")
    if price is None:
        return None

    week_high, week_low = yahoo_52_week_range(symbol)

    return {
        "symbol": meta.get("symbol", symbol),
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "price": f"{float(price):.2f}",
        "fiftyTwoWeekHigh": f"{week_high:.2f}" if week_high is not None else "",
        "fiftyTwoWeekLow": f"{week_low:.2f}" if week_low is not None else "",
        "currency": meta.get("currency", ""),
        "marketState": meta.get("marketState", ""),
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, message):
        self.send_json(status, {"error": message})

    def send_html(self, status, html):
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def user_from_token(self, token):
        session = SESSIONS.get(token)
        if not session or session["expires"] < now_ms():
            SESSIONS.pop(token, None)
            return None
        data = read_data()
        return next((user for user in data["users"] if user["code"] == session["code"]), None)

    def current_user(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return None

        token = auth.removeprefix("Bearer ").strip()
        return self.user_from_token(token)

    def require_user(self):
        user = self.current_user()
        if not user:
            self.send_error_json(401, "Login required.")
            return None
        return user

    def is_admin(self, user):
        return user.get("role") == "admin"

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/version":
            self.send_json(200, {"version": APP_VERSION})
            return

        if path == "/api/me":
            user = self.require_user()
            if not user:
                return
            self.send_json(200, {"user": public_user(user)})
            return

        if path == "/api/users":
            user = self.require_user()
            if not user:
                return
            if not self.is_admin(user):
                self.send_error_json(403, "Admin access required.")
                return
            users = [public_user(entry) for entry in read_data()["users"] if entry["role"] != "admin"]
            self.send_json(200, {"users": users})
            return


        if path == "/api/records":
            user = self.require_user()
            if not user:
                return
            records = read_data()["records"]
            if not self.is_admin(user):
                records = [record for record in records if record.get("ownerCode") == user["code"]]
            self.send_json(200, {"records": records})
            return

        if path == "/api/shares/search":
            user = self.require_user()
            if not user:
                return
            query = self.path.split("?", 1)[1] if "?" in self.path else ""
            params = parse_qs(query)
            search_text = params.get("q", [""])[0].strip()
            if len(search_text) < 2:
                self.send_json(200, {"results": []})
                return
            try:
                self.send_json(200, {"results": yahoo_search(search_text)})
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                self.send_error_json(503, "NSE share search is unavailable. Please check the server computer's internet connection.")
            return

        if path == "/api/shares/quote":
            user = self.require_user()
            if not user:
                return
            query = self.path.split("?", 1)[1] if "?" in self.path else ""
            params = parse_qs(query)
            symbol = params.get("symbol", [""])[0].strip().upper()
            if not symbol:
                self.send_error_json(400, "Share symbol is required.")
                return
            if not symbol.endswith(".NS"):
                self.send_error_json(400, "Only NSE India symbols are allowed.")
                return
            try:
                quote_data = yahoo_quote(symbol)
                if not quote_data:
                    self.send_error_json(404, "Live price is unavailable for the selected share.")
                    return
                self.send_json(200, {"quote": quote_data})
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
                self.send_error_json(503, "Live price is unavailable. Please check the server computer's internet connection.")
            return

        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        try:
            body = get_json_body(self)
        except json.JSONDecodeError:
            self.send_error_json(400, "Invalid JSON.")
            return

        if path == "/api/login":
            code = normalize_code(body.get("code"))
            password_hash = hash_password(str(body.get("password", "")).strip())
            data = read_data()
            user = next((entry for entry in data["users"] if entry["code"] == code), None)

            if not user or user.get("passwordHash") != password_hash:
                self.send_error_json(401, "Invalid user code or password.")
                return

            self.send_json(200, {"token": create_token(user["code"]), "user": public_user(user)})
            return

        user = self.require_user()
        if not user:
            return


        if path == "/api/reset-password":
            if not self.is_admin(user):
                self.send_error_json(403, "Admin access required.")
                return

            code = normalize_code(body.get("code"))
            if not code:
                self.send_error_json(400, "Client code is required.")
                return
            if code == "ADMIN":
                self.send_error_json(400, "ADMIN password cannot be reset here.")
                return

            data = read_data()
            target = next((entry for entry in data["users"] if entry["code"] == code and entry.get("role") == "user"), None)
            if not target:
                self.send_error_json(404, f"Client user {code} not found.")
                return

            data["users"] = [
                {**entry, "passwordHash": hash_password("123")} if entry["code"] == code else entry
                for entry in data["users"]
            ]
            write_data(data)
            self.send_json(200, {"ok": True})
            return

        if path.startswith("/api/users/") and path.endswith("/reset-password"):
            if not self.is_admin(user):
                self.send_error_json(403, "Admin access required.")
                return

            code = normalize_code(unquote(path.removeprefix("/api/users/").removesuffix("/reset-password")))
            if code == "ADMIN":
                self.send_error_json(400, "ADMIN password cannot be reset here.")
                return

            data = read_data()
            updated = False
            data["users"] = [
                {**entry, "passwordHash": hash_password("123")} if entry["code"] == code and entry.get("role") == "user" else entry
                for entry in data["users"]
            ]
            updated = any(entry["code"] == code and entry.get("role") == "user" for entry in data["users"])
            if not updated:
                self.send_error_json(404, "Client user not found.")
                return

            write_data(data)
            self.send_json(200, {"ok": True})
            return

        if path == "/api/users":
            if not self.is_admin(user):
                self.send_error_json(403, "Admin access required.")
                return

            code = normalize_code(body.get("code"))
            name = str(body.get("name", "")).strip()
            broker_name = str(body.get("brokerName", "")).strip()
            default_password = "123"

            if broker_name not in {"Kotak Neo", "SMC Global"}:
                self.send_error_json(400, "Please select a valid broker for this user.")
                return

            if not code or not name:
                self.send_error_json(400, "User code and name are required.")
                return
            if code == "ADMIN":
                self.send_error_json(400, "ADMIN user cannot be changed here.")
                return

            data = read_data()
            existing = next((entry for entry in data["users"] if entry["code"] == code), None)
            next_user = {
                "code": code,
                "name": name,
                "brokerName": broker_name,
                "passwordHash": existing.get("passwordHash") if existing else hash_password(default_password),
                "role": "user",
                "createdAt": existing.get("createdAt") if existing else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }

            if existing:
                data["users"] = [next_user if entry["code"] == code else entry for entry in data["users"]]
            else:
                data["users"].append(next_user)

            write_data(data)
            self.send_json(200, {"user": public_user(next_user)})
            return


        if path == "/api/change-password":
            current_password = str(body.get("currentPassword", ""))
            new_password = str(body.get("newPassword", ""))

            if user.get("passwordHash") != hash_password(current_password):
                self.send_error_json(400, "Current password is incorrect.")
                return
            if len(new_password) < 3:
                self.send_error_json(400, "New password must be at least 3 characters.")
                return

            data = read_data()
            data["users"] = [
                {**entry, "passwordHash": hash_password(new_password)} if entry["code"] == user["code"] else entry
                for entry in data["users"]
            ]
            write_data(data)
            self.send_json(200, {"ok": True})
            return

        if path == "/api/admin-password":
            if not self.is_admin(user):
                self.send_error_json(403, "Admin access required.")
                return

            current_password = str(body.get("currentPassword", ""))
            new_password = str(body.get("newPassword", ""))

            if user.get("passwordHash") != hash_password(current_password):
                self.send_error_json(400, "Current admin password is incorrect.")
                return
            if len(new_password) < 6:
                self.send_error_json(400, "New admin password must be at least 6 characters.")
                return

            data = read_data()
            data["users"] = [
                {**entry, "passwordHash": hash_password(new_password)} if entry["code"] == "ADMIN" else entry
                for entry in data["users"]
            ]
            write_data(data)
            self.send_json(200, {"ok": True})
            return

        if path == "/api/records":
            client_code = user["code"]
            share_name = str(body.get("shareName", "")).strip().upper()
            share_symbol = str(body.get("shareSymbol", "")).strip().upper()
            if not share_name or not share_symbol:
                self.send_error_json(400, "Share Name and Share Symbol are required.")
                return
            if not share_symbol.endswith(".NS"):
                self.send_error_json(400, "Only NSE India symbols are allowed.")
                return

            try:
                starting_price = float(body.get("startingPrice", 0))
                lower_limit = float(body.get("lowerLimit", 0))
                order_qty = int(float(body.get("orderQty", 0)))
                buy_entry_step = float(body.get("buyEntryStep", 0))
                buy_exit_step = float(body.get("buyExitStep", 0))
            except (TypeError, ValueError):
                self.send_error_json(400, "Starting Price, Lower Limit, Order Qty, Buy Entry Step, and Buy Exit Step must be valid numbers.")
                return

            if lower_limit > starting_price:
                self.send_error_json(400, "Lower Limit cannot be higher than Starting Price.")
                return

            data = read_data()
            broker_name = user.get("brokerName", "")

            try:
                quote_data = yahoo_quote(share_symbol)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
                self.send_error_json(503, "Live price is unavailable. Please check the server computer's internet connection.")
                return

            if not quote_data:
                self.send_error_json(400, "Selected share symbol could not be verified.")
                return

            entry_count, total_fund, avg_price, profit_per_step, total_profit = calculate_deployment(starting_price, lower_limit, order_qty, buy_entry_step, buy_exit_step)

            record = {
                "id": secrets.token_urlsafe(16),
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "ownerCode": client_code,
                "clientCode": client_code,
                "brokerName": broker_name,
                "shareName": share_name,
                "shareSymbol": quote_data["symbol"],
                "livePrice": quote_data["price"],
                "livePriceAt": quote_data["updatedAt"],
                "startingPrice": f"{starting_price:.2f}",
                "lowerLimit": f"{lower_limit:.2f}",
                "orderQty": str(order_qty),
                "buyEntryStep": f"{buy_entry_step:.2f}",
                "buyExitStep": f"{buy_exit_step:.2f}",
                "entryCount": str(entry_count),
                "totalFund": f"{total_fund:.2f}",
                "avgPrice": f"{avg_price:.2f}",
                "profitPerStep": f"{profit_per_step:.2f}",
                "totalProfit": f"{total_profit:.2f}",
            }

            data["records"].insert(0, record)
            write_data(data)
            self.send_json(201, {"record": record})
            return

        self.send_error_json(404, "Not found.")

    def do_DELETE(self):
        path = self.path.split("?", 1)[0]
        user = self.require_user()
        if not user:
            return

        if path == "/api/records":
            if not self.is_admin(user):
                self.send_error_json(403, "Admin access required.")
                return
            data = read_data()
            data["records"] = []
            write_data(data)
            self.send_json(200, {"ok": True})
            return

        if path.startswith("/api/records/"):
            record_id = unquote(path.removeprefix("/api/records/"))
            data = read_data()
            target = next((record for record in data["records"] if record["id"] == record_id), None)

            if not target:
                self.send_error_json(404, "Record not found.")
                return
            if not self.is_admin(user) and target.get("ownerCode") != user["code"]:
                self.send_error_json(403, "You can delete only your own record.")
                return

            data["records"] = [record for record in data["records"] if record["id"] != record_id]
            write_data(data)
            self.send_json(200, {"ok": True})
            return

        if path.startswith("/api/users/"):
            if not self.is_admin(user):
                self.send_error_json(403, "Admin access required.")
                return
            code = normalize_code(unquote(path.removeprefix("/api/users/")))
            if code == "ADMIN":
                self.send_error_json(400, "ADMIN user cannot be deleted.")
                return

            data = read_data()
            data["users"] = [entry for entry in data["users"] if entry["code"] != code]
            write_data(data)
            self.send_json(200, {"ok": True})
            return

        self.send_error_json(404, "Not found.")


if __name__ == "__main__":
    read_data()
    server = ThreadingHTTPServer(("0.0.0.0", 8000), AppHandler)
    print("Stock Deploy Order running at http://localhost:8000")
    print("Use your computer IP address on mobile, for example http://192.168.1.10:8000")
    server.serve_forever()
