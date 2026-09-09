// The "Retrain Trigger" box in docs/architecture-future.png -- a
// deliberately small Go function, the one place Go has a legitimate home
// in this stack (see docs/README-Future.md). Receives a POST from API
// Gateway and triggers an Airflow DAG run on demand, instead of waiting on
// Airflow's own schedule -- handy right after a fresh labeling batch lands.
//
// Airflow credentials come from Secrets Manager at invocation time, not a
// plaintext environment variable -- see fetchCredentials.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// airflowCredentials mirrors the JSON shape of the secret referenced by the
// AIRFLOW_CREDENTIALS_SECRET_ARN environment variable:
// {"username": "...", "password": "..."}.
type airflowCredentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func fetchCredentials(ctx context.Context, secretArn string) (*airflowCredentials, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading AWS config: %w", err)
	}
	client := secretsmanager.NewFromConfig(cfg)
	out, err := client.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
		SecretId: aws.String(secretArn),
	})
	if err != nil {
		return nil, fmt.Errorf("fetching secret %s: %w", secretArn, err)
	}
	var creds airflowCredentials
	if err := json.Unmarshal([]byte(aws.ToString(out.SecretString)), &creds); err != nil {
		return nil, fmt.Errorf("parsing secret JSON: %w", err)
	}
	return &creds, nil
}

// triggerDagRun POSTs to Airflow's REST API to start a vfr_pipeline run.
// Omitting dag_run_id in the body lets Airflow assign one automatically.
func triggerDagRun(ctx context.Context, baseURL, dagID string, creds *airflowCredentials) (int, string, error) {
	url := fmt.Sprintf("%s/api/v1/dags/%s/dagRuns", baseURL, dagID)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader([]byte(`{}`)))
	if err != nil {
		return 0, "", fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(creds.Username, creds.Password)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, "", fmt.Errorf("calling Airflow: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, "", fmt.Errorf("reading Airflow response: %w", err)
	}
	return resp.StatusCode, string(respBody), nil
}

func errorResponse(status int, message string) events.APIGatewayProxyResponse {
	payload, _ := json.Marshal(map[string]string{"error": message})
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers:    map[string]string{"Content-Type": "application/json"},
		Body:       string(payload),
	}
}

func handler(ctx context.Context, _ events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	baseURL := os.Getenv("AIRFLOW_BASE_URL")
	dagID := os.Getenv("AIRFLOW_DAG_ID")
	secretArn := os.Getenv("AIRFLOW_CREDENTIALS_SECRET_ARN")

	if baseURL == "" || dagID == "" || secretArn == "" {
		return errorResponse(500, "missing required environment variables: "+
			"AIRFLOW_BASE_URL, AIRFLOW_DAG_ID, AIRFLOW_CREDENTIALS_SECRET_ARN"), nil
	}

	creds, err := fetchCredentials(ctx, secretArn)
	if err != nil {
		return errorResponse(502, err.Error()), nil
	}

	status, body, err := triggerDagRun(ctx, baseURL, dagID, creds)
	if err != nil {
		return errorResponse(502, err.Error()), nil
	}
	if status >= 300 {
		return errorResponse(502, fmt.Sprintf("Airflow returned %d: %s", status, body)), nil
	}

	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers:    map[string]string{"Content-Type": "application/json"},
		Body:       body,
	}, nil
}

func main() {
	lambda.Start(handler)
}
