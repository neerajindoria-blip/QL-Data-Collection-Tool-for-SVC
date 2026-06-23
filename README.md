# Quantlab Stock Deploy Order

Quantlab-branded mobile-first data collection app for saving multiple client records on the same device.

## Login

Default admin login:

```text
User Code: ADMIN
Password: admin123
```

After login, admin can create client users from **User Additions**. Client users are created with the default password `123`. Clients can change this password after login. First change the default admin password from **Change Admin Password**.

## Fields

- Client Code
- Broker
- NSE Share Search / Share Name
- Share Symbol
- Live Price
- Starting Price
- Lower Limit
- Order Qty
- Buy Entry Step
- Buy Exit Step
- Estimated Entries
- Total Fund Deployed
- Average Entry Price
- Profit Per Step
- Total Profit at Max Entries

## Launch on Computer

### Easy Method

1. Double-click `start-app.bat`.
2. Keep that window open.
3. Open this URL in your browser:

   ```text
   http://localhost:8000
   ```

### PowerShell Method

1. Open PowerShell in this folder:

   ```powershell
   cd "C:\Users\Neeraj\Documents\Data Collection Tool"
   ```

2. Start a local server:

   ```powershell
   python server.py
   ```

3. Open this URL in your browser:

   ```text
   http://localhost:8000
   ```

## Use on Mobile

1. Keep the computer and mobile connected to the same Wi-Fi.
2. Find the computer IP address:

   ```powershell
   ipconfig
   ```

   Use the IPv4 address shown under your Wi-Fi adapter, for example `192.168.1.10`.

3. On the mobile browser, open:

   ```text
   http://YOUR-IP-ADDRESS:8000
   ```

   Example:

   ```text
   http://192.168.1.10:8000
   ```

4. To install like an app:

   - Android Chrome: open menu, tap **Add to Home screen** or **Install app**.
   - iPhone Safari: tap Share, then **Add to Home Screen**.

## How to Use

1. Login as `ADMIN`.
2. Change the default admin password.
3. Create each client user with a unique user code, for example `C001`, `C002`.
4. Share that user code and default password `123` with that client.
5. Client logs in with their own user code and password `123`.
6. Client searches the NSE share by name or symbol, then selects one of the suggestions.
7. The app fetches the live/latest market price and fills **Starting Price**.
8. Client fills the remaining fields, reviews **Total Fund Deployed** and **Average Entry Price**, **Profit Per Step**, and **Total Profit at Max Entries**, and taps **Save Stock Entry**.
9. Admin can see all records.
10. A normal client can see only records saved under their own user code.
11. Tap **CSV** to download visible records as a CSV file.
12. Tap **Delete** on one record to remove it.
13. Admin can tap **Delete All** to clear all saved records.

## Data Storage

Records and users are saved centrally in this folder's `data.json` file while `server.py` is running. Client passwords are stored as password hashes, not plain text.

Keep `data.json` backed up. If you delete it, the app will create a fresh file with only the default admin login.

## Live Price

NSE share search and live/latest price lookup use an internet connection from the server computer. If the server computer is offline or the market data provider is unavailable, the app will show an English warning and will not save an unverified NSE share symbol.



## Deployment Calculation

Starting Price is treated as a reference. The first entry is calculated from Starting Price minus Buy Entry Step, then further entries continue downward by Buy Entry Step until Lower Limit. Partial final steps are rounded down and not counted.


## Backtesting

Saved stock entries include a **Backtest 1Y** action. It uses Yahoo Finance 1 year daily candles and applies a conservative rule: an entry and exit on the same daily candle are not counted as a closed trade because intraday sequence is unknown.
