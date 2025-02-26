# Mobile Financial Service (MFS) Client

This is the client-side application for a Mobile Financial Service (MFS) similar to bKash or Nagad. It is built using React.js and various other libraries to provide a secure and responsive user interface.

## Live Link

- [Live Application](https://mfs-ph.web.app)

## Client Repository

- [MFS Client on GitHub](https://github.com/Naiemjoy1/ph_task_client)

## Users & Credentials

### Admin

- **Email:** admin@mfs.com
- **Password:** 12345

### Agent

- **Email:** agent@mfs.com
- **Password:** 12345

### User

- **Email:** user1@mfs.com
- **Password:** 12345

---

## Features

### General Features

- User Registration and Login (JWT Authentication, Secure Routes)
- Send Money (Fee Applied for Transactions Over 100 Taka)
- Cash-In (Free)
- Cash Withdrawal (1.5% Fee)
- Balance Inquiry
- Transaction History
- Role-Based Dashboard (User, Agent, Admin)
- Secure Authentication (JWT & Hash Encryption)
- One Device Login Restriction

### Role-Specific Features

#### **User**

- Register and receive a **40 Taka** bonus.
- Send money to other users (**5 Taka fee for transactions over 100 Taka**).
- Cash-in from an agent **without any fee**.
- Cash-out via an agent (**1.5% fee applied**).
- View balance (Initially blurred, revealed on click).
- View transaction history.

#### **Agent**

- Register and wait for **admin approval**.
- Receive an initial balance of **100,000 Taka**.
- Request balance recharge from the admin.
- Earn **1% commission** on user cash-outs.
- View earnings (Initially blurred, revealed on click).
- View transaction history.

#### **Admin**

- Manage users (View balances, transaction history, and block accounts).
- Verify and approve agents.
- Add money to agent accounts.
- Earn **0.5% from cash-out transactions**.
- Earn **5 Taka from every monetary operation**.
- Monitor the **total money in the system**.
- Approve or reject agent balance recharge requests.
- Approve or reject agent withdrawal requests.

---

## Tech Stack

- **Frontend:** React.js, React Query, Axios, React Router DOM, Sweetalert2, Recharts
- **Backend:** Node.js, Express.js, MongoDB, Mongoose
- **Security:** JWT Authentication, Hash Encryption

---

## Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/Naiemjoy1/ph_task_server
   ```

2. **Navigate to Project Directory:**

   ```bash
   cd mfs-client
   ```

3. **Install Dependencies:**

   ```bash
   npm install
   ```

4. **Start the Application:**
   ```bash
   npm start
   ```

---

## Additional Functionalities

- **Cash Request (Agent):** Agents can request balance recharge from the admin.
- **Withdraw Request (Agent):** Agents can request withdrawal approval from the admin.
- **Admin Withdrawal Approval:** Admins can accept/reject agent withdrawal requests.

This project serves as a **Skill Assessment Task** to evaluate expertise in building a secure and functional Mobile Financial Service platform using **Node.js, Express.js, React.js, and MongoDB**.
