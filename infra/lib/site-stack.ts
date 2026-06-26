import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";

export interface SiteStackProps extends cdk.StackProps {
  domainName: string;
  siteHost: "apex" | "www";
  ownerEmail: string;
  googleClientId: string;
  siteTitle: string;
  siteDescription: string;
}

export class SiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    const siteDomain =
      props.siteHost === "www"
        ? `www.${props.domainName}`
        : props.domainName;
    const siteBaseUrl = `https://${siteDomain}`;

    // --- DNS + TLS ---------------------------------------------------------
    // The hosted zone is created up front (outside this stack) so its
    // nameservers can be delegated at the registrar before the certificate is
    // requested — otherwise ACM DNS validation would hang. We look it up here.
    const zone = route53.HostedZone.fromLookup(this, "Zone", {
      domainName: props.domainName,
    });

    const cert = new acm.Certificate(this, "Cert", {
      domainName: siteDomain,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    // --- Storage (private; holds site, images, posts.json) -----------------
    const bucket = new s3.Bucket(this, "SiteBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // Protect uploaded art: keep the bucket if the stack is ever deleted.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- Admin Lambda (create / finalize / delete) -------------------------
    const fn = new lambda.Function(this, "AdminFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "..", "lambda", "dist"),
      ),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        BUCKET: bucket.bucketName,
        SITE_BASE_URL: siteBaseUrl,
        OWNER_EMAIL: props.ownerEmail,
        GOOGLE_CLIENT_ID: props.googleClientId,
        SITE_TITLE: props.siteTitle,
        // DISTRIBUTION_ID added below once the distribution exists.
      },
    });
    bucket.grantReadWrite(fn);

    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // --- SPA routing at the edge -------------------------------------------
    // Map directory-style URLs to their index.html and send extensionless app
    // routes (e.g. /admin) to the SPA shell. We do NOT use CloudFront custom
    // error pages, because those would rewrite the API's 4xx responses too.
    const rewriteFn = new cloudfront.Function(this, "SpaRewrite", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.startsWith('/api/')) return req;
  if (uri.endsWith('/')) { req.uri = uri + 'index.html'; return req; }
  if (uri.indexOf('.') === -1) { req.uri = '/index.html'; }
  return req;
}
`),
    });

    // --- CDN ---------------------------------------------------------------
    const dist = new cloudfront.Distribution(this, "Dist", {
      defaultRootObject: "index.html",
      domainNames: [siteDomain],
      certificate: cert,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // cheapest (NA + EU)
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: rewriteFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(fnUrl),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    // Now the Lambda can invalidate the distribution after publishing.
    fn.addEnvironment("DISTRIBUTION_ID", dist.distributionId);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${dist.distributionId}`,
        ],
      }),
    );

    // --- DNS records pointing at CloudFront --------------------------------
    const recordName = props.siteHost === "www" ? "www" : undefined;
    const aliasTarget = route53.RecordTarget.fromAlias(
      new targets.CloudFrontTarget(dist),
    );
    new route53.ARecord(this, "AliasA", {
      zone,
      recordName,
      target: aliasTarget,
    });
    new route53.AaaaRecord(this, "AliasAAAA", {
      zone,
      recordName,
      target: aliasTarget,
    });

    // --- Deploy the built site + runtime config ----------------------------
    // prune:false so user uploads (images/, p/*, data/posts.json) survive
    // redeploys. posts.json is owned by the Lambda and never shipped here.
    new s3deploy.BucketDeployment(this, "DeployWeb", {
      destinationBucket: bucket,
      sources: [
        s3deploy.Source.asset(
          path.join(__dirname, "..", "..", "web", "dist"),
        ),
        s3deploy.Source.jsonData("site-config.json", {
          googleClientId: props.googleClientId,
          siteTitle: props.siteTitle,
          siteDescription: props.siteDescription,
        }),
      ],
      prune: false,
      distribution: dist,
      distributionPaths: ["/index.html", "/assets/*", "/site-config.json"],
      cacheControl: [
        s3deploy.CacheControl.setPublic(),
        s3deploy.CacheControl.maxAge(cdk.Duration.hours(1)),
      ],
    });

    // --- Outputs -----------------------------------------------------------
    new cdk.CfnOutput(this, "SiteUrl", { value: siteBaseUrl });
    new cdk.CfnOutput(this, "DistributionDomain", {
      value: dist.distributionDomainName,
    });
    new cdk.CfnOutput(this, "BucketName", { value: bucket.bucketName });
  }
}
