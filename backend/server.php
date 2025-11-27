<?php
/**
 * RENAME THIS FILE TO server.php
 * 
 * GeoGuide AI - PHP Backend Implementation (Local Mode)
 * 
 * Usage:
 * Place this file in your web server's document root or a subdirectory.
 * Update your frontend constants.ts API_BASE_URL to point to this script.
 * e.g., 'http://localhost:8000/server.php/api' or just 'http://localhost:8000/api' if using .htaccess rewriting.
 */

// Headers for CORS
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Configuration
$dataFile = __DIR__ . '/tours.json';
$uploadsDir = __DIR__ . '/uploads';
$baseUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://$_SERVER[HTTP_HOST]";
// Handle subdirectory logic if needed, simplifed here:
$scriptDir = dirname($_SERVER['SCRIPT_NAME']);
$uploadsUrl = rtrim($baseUrl . $scriptDir, '/') . '/uploads';

// Ensure uploads directory exists
if (!file_exists($uploadsDir)) {
    mkdir($uploadsDir, 0777, true);
}

// Helper: Read Data
function getTours() {
    global $dataFile;
    if (!file_exists($dataFile)) return [];
    $content = file_get_contents($dataFile);
    return json_decode($content, true) ?: [];
}

// Helper: Save Data
function saveTours($tours) {
    global $dataFile;
    file_put_contents($dataFile, json_encode($tours, JSON_PRETTY_PRINT));
}

// Parse Request URI
$requestUri = $_SERVER['REQUEST_URI'];
$method = $_SERVER['REQUEST_METHOD'];

// Simple Router Logic
// Route: /api/upload
if (strpos($requestUri, '/api/upload') !== false && $method === 'POST') {
    if (isset($_FILES['file'])) {
        $file = $_FILES['file'];
        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
        $filename = time() . '-' . rand(1000, 9999) . '.' . $ext;
        $destination = $uploadsDir . '/' . $filename;

        if (move_uploaded_file($file['tmp_name'], $destination)) {
            echo json_encode(['url' => $uploadsUrl . '/' . $filename]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save file']);
        }
    } else {
        http_response_code(400);
        echo json_encode(['message' => 'No file uploaded']);
    }
    exit;
}

// Route: /api/tours or /api/tours/:id
if (strpos($requestUri, '/api/tours') !== false) {
    // Extract ID if present
    // Assuming URI format ends with /api/tours or /api/tours/123
    // We strip query params first
    $path = parse_url($requestUri, PHP_URL_PATH);
    $parts = explode('/', trim($path, '/'));
    // Find 'tours' in parts and get the next element
    $toursIndex = array_search('tours', $parts);
    $id = ($toursIndex !== false && isset($parts[$toursIndex + 1])) ? $parts[$toursIndex + 1] : null;

    $tours = getTours();

    switch ($method) {
        case 'GET':
            if ($id) {
                $found = null;
                foreach ($tours as $t) {
                    if ($t['id'] === $id) {
                        $found = $t;
                        break;
                    }
                }
                if ($found) echo json_encode($found);
                else {
                    http_response_code(404);
                    echo json_encode(['message' => 'Not found']);
                }
            } else {
                echo json_encode($tours);
            }
            break;

        case 'POST':
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input) {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid JSON']);
                exit;
            }
            if (!isset($input['id'])) {
                $input['id'] = 'tour-' . time();
            }
            
            // Check if exists to update, or push new
            $exists = false;
            foreach ($tours as $k => $t) {
                if ($t['id'] === $input['id']) {
                    $tours[$k] = $input;
                    $exists = true;
                    break;
                }
            }
            if (!$exists) {
                $tours[] = $input;
            }
            
            saveTours($tours);
            http_response_code(201);
            echo json_encode($input);
            break;

        case 'PUT':
            if (!$id) {
                http_response_code(400);
                echo json_encode(['error' => 'ID required']);
                exit;
            }
            $input = json_decode(file_get_contents('php://input'), true);
            
            $updated = false;
            foreach ($tours as $k => $t) {
                if ($t['id'] === $id) {
                    $tours[$k] = array_merge($t, $input); // Merge updates
                    $updated = true;
                    break;
                }
            }
            
            // If not found, create it (Upsert logic from JS)
            if (!$updated) {
                 $tours[] = $input;
            }

            saveTours($tours);
            echo json_encode($input);
            break;

        case 'DELETE':
            if (!$id) {
                http_response_code(400);
                echo json_encode(['error' => 'ID required']);
                exit;
            }
            $newTours = [];
            foreach ($tours as $t) {
                if ($t['id'] !== $id) {
                    $newTours[] = $t;
                }
            }
            saveTours($newTours);
            http_response_code(204);
            break;
    }
    exit;
}

// Default
echo "GeoGuide PHP Backend. Use /api/tours";
?>
