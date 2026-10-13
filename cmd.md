# Running the LifeLink Project

Here are the commands needed to set up and run this project.

### 1. Install Dependencies
Install the backend dependencies in the root folder:
```bash
npm install
```

Then, install the frontend dependencies in the `client` folder:
```bash
cd client
npm install
cd ..
```
*(Alternatively, you can run `npm install --prefix client` from the root folder.)*

### 2. Set Up the Database
Initialize the SQLite database and seed it with dummy data:
```bash
npm run setup
```

### 3. Run the Application
Start both the backend server and frontend client concurrently:
```bash
npm run dev
```

The client will typically run on `http://localhost:5173` and the backend server on `http://localhost:8000`.
